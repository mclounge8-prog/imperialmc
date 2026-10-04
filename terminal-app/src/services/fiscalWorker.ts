import {
  fetchAtolSettings,
  fetchNextFiscalJob,
  reportFiscalJobResult,
  type AtolSettings,
  type FiscalJob,
} from '../api/client';
import { notifyFiscalError } from '../context/FiscalAlertsContext';
import {
  isAtolAvailablePlatform,
  queryLastFiscalDocument,
  runAtolTask,
  type AtolConnectionSettings,
} from '../native/atol';
import {
  extractResponseFields,
  isSellLikeJob,
  receiptHasFiscalDoc,
  shouldAdoptLastDocument,
} from './fiscalReconcile';

// Настройки читаем на каждый проход очереди (раз в ~15с). Раньше кэш на
// всю сессию ломал Карлу/новые точки: включили АТОЛ в бэкофисе, а терминал
// продолжал считать enabled:false → задания висели pending с attempts=0.
async function getSettings(venueId: number, token: string): Promise<AtolSettings> {
  return fetchAtolSettings(venueId, token);
}

export function invalidateAtolSettingsCache(_venueId?: number): void {
  // no-op: кэш убран; функция оставлена для старых вызовов/OTA-совместимости
}

function jobTypeLabel(type: string): string {
  if (type === 'receipt') return 'Чек';
  if (type === 'receipt_return') return 'Возврат';
  if (type === 'receipt_copy') return 'Копия чека';
  if (type === 'precheck') return 'Предчек';
  if (type === 'open_shift') return 'Открытие смены';
  if (type === 'close_shift') return 'Закрытие смены';
  if (type === 'x_report') return 'X-отчёт';
  if (type === 'cash_in') return 'Внесение';
  if (type === 'cash_out') return 'Инкассация';
  return type;
}

function connectionOf(settings: AtolSettings): AtolConnectionSettings {
  return {
    ipAddress: settings.ipAddress as string,
    ipPort: settings.ipPort ?? 5555,
    model: settings.model,
  };
}

async function tryAdoptPrintedDocument(
  job: FiscalJob,
  settings: AtolSettings
): Promise<ReturnType<typeof extractResponseFields> | null> {
  if (!isSellLikeJob(job.type)) return null;
  try {
    const last = await queryLastFiscalDocument(connectionOf(settings));
    const fields = extractResponseFields(last);
    if (
      shouldAdoptLastDocument({
        jobType: job.type,
        attempts: job.attempts,
        venueLastFiscalDocNumber: job.venueLastFiscalDocNumber,
        lastDocNumber: fields.fiscalDocNumber,
      })
    ) {
      console.log(
        `[ATOL] задание #${job.id} — зачитываю уже пробитый ФД ${fields.fiscalDocNumber}, повторный sell не отправляю`
      );
      return fields;
    }
  } catch (err) {
    console.warn(
      `[ATOL] задание #${job.id} — не удалось прочитать последний ФД:`,
      err instanceof Error ? err.message : err
    );
  }
  return null;
}

const runningForVenue = new Set<number>();

// Разбирает очередь фискальных заданий. Не бросает наружу и не блокирует UI —
// ошибки уходят в FiscalAlerts (чип в шапке + экран «Касса АТОЛ»).
export async function runPendingFiscalJobs(venueId: number, token: string): Promise<void> {
  if (!isAtolAvailablePlatform()) {
    console.warn('[ATOL] нативный модуль AtolModule не найден — пропускаю');
    return;
  }
  if (runningForVenue.has(venueId)) {
    return;
  }
  runningForVenue.add(venueId);

  try {
    const settings = await getSettings(venueId, token);
    if (!settings.enabled || !settings.ipAddress) {
      return;
    }

    for (let i = 0; i < 20; i += 1) {
      const job = await fetchNextFiscalJob(venueId, token);
      if (!job) break;

      try {
        // Повтор sell после «неуспеха» — частая причина лишнего ФД: касса
        // уже пробила, планшет не разобрал ответ и очередь шлёт тот же чек.
        if (isSellLikeJob(job.type) && job.attempts >= 2) {
          const adopted = await tryAdoptPrintedDocument(job, settings);
          if (adopted) {
            await reportFiscalJobResult(job.id, token, {
              success: true,
              fiscalDocNumber: adopted.fiscalDocNumber,
              fiscalSign: adopted.fiscalSign,
              fiscalDatetime: adopted.fiscalDatetime,
            });
            continue;
          }
        }

        // Сервер не отдаёт просроченный close_shift (уже открыта следующая
        // смена): closeShift на ККТ закрыл бы текущую фискальную смену.
        const task = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        const response = await runAtolTask(connectionOf(settings), task);
        console.log(`[ATOL] задание #${job.id} — ответ кассы:`, JSON.stringify(response));
        const fields = extractResponseFields(response);

        if (isSellLikeJob(job.type) && !receiptHasFiscalDoc(fields, job.type)) {
          const adopted = await tryAdoptPrintedDocument(job, settings);
          if (adopted) {
            await reportFiscalJobResult(job.id, token, {
              success: true,
              fiscalDocNumber: adopted.fiscalDocNumber,
              fiscalSign: adopted.fiscalSign,
              fiscalDatetime: adopted.fiscalDatetime,
            });
            continue;
          }
          const message =
            `Касса ответила без fiscalDocumentNumber: ${JSON.stringify(response)}`;
          console.warn(`[ATOL] задание #${job.id} — ${message}`);
          notifyFiscalError({
            kind: 'atol',
            jobId: job.id,
            title: `${jobTypeLabel(job.type)} #${job.id}`,
            message,
          });
          await reportFiscalJobResult(job.id, token, { success: false, error: message }).catch(() => {});
          continue;
        }

        await reportFiscalJobResult(job.id, token, {
          success: true,
          fiscalDocNumber: fields.fiscalDocNumber,
          fiscalSign: fields.fiscalSign,
          fiscalDatetime: fields.fiscalDatetime,
        });
      } catch (err) {
        const adopted = isSellLikeJob(job.type)
          ? await tryAdoptPrintedDocument(job, settings)
          : null;
        if (adopted) {
          await reportFiscalJobResult(job.id, token, {
            success: true,
            fiscalDocNumber: adopted.fiscalDocNumber,
            fiscalSign: adopted.fiscalSign,
            fiscalDatetime: adopted.fiscalDatetime,
          });
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ATOL] задание #${job.id} — ошибка:`, message);
        notifyFiscalError({
          kind: 'atol',
          jobId: job.id,
          title: `${jobTypeLabel(job.type)} #${job.id}`,
          message,
        });
        await reportFiscalJobResult(job.id, token, { success: false, error: message }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[ATOL] не удалось получить настройки/связаться с backend:', err);
    notifyFiscalError({
      kind: 'server',
      title: 'Связь с сервером',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    runningForVenue.delete(venueId);
  }
}

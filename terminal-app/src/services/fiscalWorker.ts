import {
  fetchAtolSettings,
  fetchNextFiscalJob,
  reportFiscalJobResult,
  type AtolSettings,
} from '../api/client';
import { notifyFiscalError } from '../context/FiscalAlertsContext';
import { isAtolAvailablePlatform, runAtolTask } from '../native/atol';

// Настройки читаем на каждый проход очереди (раз в ~15с). Раньше кэш на
// всю сессию ломал Карлу/новые точки: включили АТОЛ в бэкофисе, а терминал
// продолжал считать enabled:false → задания висели pending с attempts=0.
async function getSettings(venueId: number, token: string): Promise<AtolSettings> {
  return fetchAtolSettings(venueId, token);
}

export function invalidateAtolSettingsCache(_venueId?: number): void {
  // no-op: кэш убран; функция оставлена для старых вызовов/OTA-совместимости
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractResponseFields(response: unknown): {
  fiscalDocNumber: number | null;
  fiscalSign: string | null;
  fiscalDatetime: string | null;
} {
  const root = asRecord(response);
  if (!root) {
    return { fiscalDocNumber: null, fiscalSign: null, fiscalDatetime: null };
  }
  const fp = asRecord(root.fiscalParams) ?? root;
  const doc = coerceNumber(fp.fiscalDocumentNumber ?? fp.documentNumber ?? null);
  const signRaw = fp.fiscalDocumentSign ?? fp.fiscalSign ?? null;
  const sign = signRaw == null || signRaw === '' ? null : String(signRaw);
  const dtRaw = fp.fiscalDocumentDateTime ?? null;
  const fiscalDatetime = typeof dtRaw === 'string' && dtRaw ? dtRaw : null;
  return { fiscalDocNumber: doc, fiscalSign: sign, fiscalDatetime };
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
        const task = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        const response = await runAtolTask(
          { ipAddress: settings.ipAddress, ipPort: settings.ipPort ?? 5555, model: settings.model },
          task
        );
        console.log(`[ATOL] задание #${job.id} — ответ кассы:`, JSON.stringify(response));
        const { fiscalDocNumber, fiscalSign, fiscalDatetime } = extractResponseFields(response);

        if (job.type === 'receipt' && (fiscalDocNumber == null || !fiscalSign)) {
          const message =
            `Касса ответила без fiscalDocumentNumber/fiscalDocumentSign: ${JSON.stringify(response)}`;
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
          fiscalDocNumber,
          fiscalSign,
          fiscalDatetime,
        });
      } catch (err) {
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

import { Alert, NativeModules, Platform } from 'react-native';
import {
  fetchAtolSettings,
  fetchNextFiscalJob,
  reportFiscalJobResult,
  type AtolSettings,
} from '../api/client';
import { isAtolAvailablePlatform, runAtolTask } from '../native/atol';

// Настройки кассы почти никогда не меняются на ходу — кэшируем на время
// сессии, а не запрашиваем перед каждым чеком. invalidateAtolSettingsCache
// вызывается из экрана настроек после сохранения изменений в бэкофисе (если
// понадобится) — сейчас достаточно того, что кэш очищается при перезапуске
// приложения.
const settingsCache = new Map<number, AtolSettings>();

async function getSettings(venueId: number, token: string): Promise<AtolSettings> {
  const cached = settingsCache.get(venueId);
  if (cached) return cached;
  const settings = await fetchAtolSettings(venueId, token);
  settingsCache.set(venueId, settings);
  return settings;
}

export function invalidateAtolSettingsCache(venueId: number): void {
  settingsCache.delete(venueId);
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
  // Ответ processJson для sell/openShift/closeShift: поля лежат в fiscalParams.
  // Fallback из AtolModule (fnQueryData) тоже кладёт их туда.
  const fp = asRecord(root.fiscalParams) ?? root;
  const doc = coerceNumber(fp.fiscalDocumentNumber ?? fp.documentNumber ?? null);
  const signRaw = fp.fiscalDocumentSign ?? fp.fiscalSign ?? null;
  const sign = signRaw == null || signRaw === '' ? null : String(signRaw);
  const dtRaw = fp.fiscalDocumentDateTime ?? null;
  const fiscalDatetime = typeof dtRaw === 'string' && dtRaw ? dtRaw : null;
  return { fiscalDocNumber: doc, fiscalSign: sign, fiscalDatetime };
}

// Не даём двум параллельным вызовам (например, ручной вызов после оплаты +
// фоновый таймер сработали почти одновременно) разбирать очередь одного и
// того же заведения одновременно — не критично для корректности (задания и
// так забираются атомарно на backend), но выполнять их лучше по одному, а не
// параллельно, чтобы не путать состояние соединения с кассой.
const runningForVenue = new Set<number>();

// Разбирает всё, что накопилось в очереди фискальных заданий для заведения:
// открытие/закрытие смены, пробитие чеков. Тихо ничего не делает и не бросает
// исключение наружу — фискализация никогда не должна ронять основной UI
// (продажу/смену); при сбое задание просто останется в очереди до следующей
// попытки (см. useFiscalSync — периодический опрос).
export async function runPendingFiscalJobs(venueId: number, token: string): Promise<void> {
  if (!isAtolAvailablePlatform()) {
    console.warn(
      '[ATOL] недоступен на этой платформе/сборке (нативный модуль AtolModule не найден) — пропускаю'
    );
    return;
  }
  if (runningForVenue.has(venueId)) {
    console.log('[ATOL] уже выполняется для этого заведения, пропускаю повторный запуск');
    return;
  }
  runningForVenue.add(venueId);
  console.log(`[ATOL] запуск разбора очереди, venueId=${venueId}`);

  try {
    const settings = await getSettings(venueId, token);
    if (!settings.enabled || !settings.ipAddress) {
      console.log('[ATOL] касса выключена для этого заведения или не задан IP — пропускаю', settings);
      return;
    }
    console.log('[ATOL] настройки получены:', settings);

    // Ограничение итераций за один вызов — если заданий скопилось очень
    // много (например, касса была недоступна много часов), разберём их
    // порциями при следующих вызовах, а не будем крутить цикл бесконечно.
    for (let i = 0; i < 20; i += 1) {
      const job = await fetchNextFiscalJob(venueId, token);
      if (!job) {
        console.log('[ATOL] в очереди больше нет заданий');
        break;
      }
      console.log(`[ATOL] задание #${job.id} (${job.type}) — выполняю`, job.payload);

      try {
        const task = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        const response = await runAtolTask(
          { ipAddress: settings.ipAddress, ipPort: settings.ipPort ?? 5555, model: settings.model },
          task
        );
        console.log(`[ATOL] задание #${job.id} — ответ кассы:`, JSON.stringify(response));
        const { fiscalDocNumber, fiscalSign, fiscalDatetime } = extractResponseFields(response);

        // Для чека без ФД/ФПД не считаем успех — иначе в бэкофисе «done» без
        // номера, а повторно пробить уже нельзя (чек мог уйти на ленту).
        if (job.type === 'receipt' && (fiscalDocNumber == null || !fiscalSign)) {
          const message =
            `Касса ответила без fiscalDocumentNumber/fiscalDocumentSign: ${JSON.stringify(response)}`;
          console.warn(`[ATOL] задание #${job.id} — ${message}`);
          Alert.alert('ATOL', `#${job.id}: нет ФД/ФПД в ответе`);
          await reportFiscalJobResult(job.id, token, { success: false, error: message }).catch(() => {});
          continue;
        }

        Alert.alert(
          'ATOL OK',
          `#${job.id}: ФД=${fiscalDocNumber ?? '—'} ФПД=${fiscalSign ?? '—'}`
        );
        await reportFiscalJobResult(job.id, token, {
          success: true,
          fiscalDocNumber,
          fiscalSign,
          fiscalDatetime,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ATOL] задание #${job.id} — ошибка:`, message);
        Alert.alert('ATOL ошибка', `#${job.id}: ${message}`);
        await reportFiscalJobResult(job.id, token, { success: false, error: message }).catch(() => {});
      }
    }
  } catch (err) {
    // Не удалось даже получить настройки/связаться с backend — просто выходим,
    // задания останутся pending и разберутся при следующей попытке.
    console.warn('[ATOL] не удалось получить настройки/связаться с backend:', err);
  } finally {
    runningForVenue.delete(venueId);
  }
}

// ВРЕМЕННО: одна отладочная метка при загрузке модуля (без спама на каждый poll).
Alert.alert(
  'ATOL debug',
  `модуль загружен. Platform=${Platform.OS}, AtolModule=${
    NativeModules.AtolModule ? 'найден' : 'НЕ найден'
  }`
);

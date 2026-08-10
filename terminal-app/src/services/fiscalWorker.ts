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

function extractResponseFields(response: unknown): {
  fiscalDocNumber: number | null;
  fiscalSign: string | null;
} {
  if (!response || typeof response !== 'object') {
    return { fiscalDocNumber: null, fiscalSign: null };
  }
  const r = response as Record<string, unknown>;
  const doc = r.fiscalDocumentNumber ?? r.documentNumber ?? r.shiftNumber ?? null;
  const sign = r.fiscalSign ?? null;
  return {
    fiscalDocNumber: typeof doc === 'number' ? doc : null,
    fiscalSign: typeof sign === 'string' ? sign : null,
  };
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
  if (!isAtolAvailablePlatform()) return;
  if (runningForVenue.has(venueId)) return;
  runningForVenue.add(venueId);

  try {
    const settings = await getSettings(venueId, token);
    if (!settings.enabled || !settings.ipAddress) return;

    // Ограничение итераций за один вызов — если заданий скопилось очень
    // много (например, касса была недоступна много часов), разберём их
    // порциями при следующих вызовах, а не будем крутить цикл бесконечно.
    for (let i = 0; i < 20; i += 1) {
      const job = await fetchNextFiscalJob(venueId, token);
      if (!job) break;

      try {
        const task = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        const response = await runAtolTask(
          { ipAddress: settings.ipAddress, ipPort: settings.ipPort ?? 5555, model: settings.model },
          task
        );
        const { fiscalDocNumber, fiscalSign } = extractResponseFields(response);
        await reportFiscalJobResult(job.id, token, { success: true, fiscalDocNumber, fiscalSign });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await reportFiscalJobResult(job.id, token, { success: false, error: message }).catch(() => {});
      }
    }
  } catch {
    // Не удалось даже получить настройки/связаться с backend — просто выходим,
    // задания останутся pending и разберутся при следующей попытке.
  } finally {
    runningForVenue.delete(venueId);
  }
}

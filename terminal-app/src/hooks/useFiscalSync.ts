import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchAtolSettings, fetchFiscalJobs } from '../api/client';
import { useFiscalAlerts } from '../context/FiscalAlertsContext';
import { runPendingFiscalJobs } from '../services/fiscalWorker';

const POLL_INTERVAL_MS = 15000;

/**
 * Периодически:
 * - разбирает очередь АТОЛ;
 * - обновляет счётчик ошибок фискальных заданий;
 * - проверяет связь с сервером (чип «Сервер» в шапке).
 */
export function useFiscalSync(venueId: number | null | undefined, token: string | null | undefined): void {
  const {
    setServerErrorCount,
    setAtolEnabled,
    setPendingJobCount,
    setServerOnline,
    clearAlerts,
  } = useFiscalAlerts();

  useEffect(() => {
    if (!venueId || !token) return undefined;

    let cancelled = false;

    const refreshStatus = async () => {
      try {
        const [jobsRes, settings] = await Promise.all([
          fetchFiscalJobs(venueId, token, 50),
          fetchAtolSettings(venueId, token),
        ]);
        if (cancelled) return;
        setServerOnline(true);
        setServerErrorCount(jobsRes.errorCount);
        setPendingJobCount(jobsRes.pendingCount ?? 0);
        setAtolEnabled(Boolean(settings.enabled));
        if (jobsRes.errorCount === 0) clearAlerts('atol');
      } catch (err) {
        if (cancelled) return;
        setServerOnline(false, err instanceof Error ? err.message : 'Нет связи с сервером');
      }
    };

    const tick = () => {
      if (cancelled) return;
      runPendingFiscalJobs(venueId, token).finally(() => {
        if (!cancelled) void refreshStatus();
      });
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [
    venueId,
    token,
    setServerErrorCount,
    setAtolEnabled,
    setPendingJobCount,
    setServerOnline,
    clearAlerts,
  ]);
}

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchFiscalJobs } from '../api/client';
import { useFiscalAlerts } from '../context/FiscalAlertsContext';
import { runPendingFiscalJobs } from '../services/fiscalWorker';

const POLL_INTERVAL_MS = 20000;

// Периодически разбирает очередь АТОЛ и подтягивает счётчик ошибок для
// чипа в шапке. Монтируется один раз на верхнем уровне (см. App.tsx).
export function useFiscalSync(venueId: number | null | undefined, token: string | null | undefined): void {
  const { setServerErrorCount, clearAlerts } = useFiscalAlerts();

  useEffect(() => {
    if (!venueId || !token) return undefined;

    let cancelled = false;

    const refreshErrorCount = async () => {
      try {
        const { errorCount } = await fetchFiscalJobs(venueId, token, 1);
        if (cancelled) return;
        setServerErrorCount(errorCount);
        if (errorCount === 0) clearAlerts();
      } catch {
        // Счётчик не критичен — ошибки worker'а всё равно попадут в notifyFiscalError
      }
    };

    const tick = () => {
      if (cancelled) return;
      runPendingFiscalJobs(venueId, token).finally(() => {
        if (!cancelled) refreshErrorCount();
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
  }, [venueId, token, setServerErrorCount, clearAlerts]);
}

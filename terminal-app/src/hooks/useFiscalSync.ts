import { useEffect } from 'react';
import { AppState } from 'react-native';
import { runPendingFiscalJobs } from '../services/fiscalWorker';

const POLL_INTERVAL_MS = 20000;

// Периодически разбирает накопившиеся фискальные задания заведения — на
// случай, если касса была недоступна в момент самой оплаты/открытия смены
// (действие в системе уже прошло, а фискализация — нет). Монтируется один
// раз на верхнем уровне (см. App.tsx), пока есть активная сессия и заведение,
// независимо от того, какой экран сейчас открыт.
export function useFiscalSync(venueId: number | null | undefined, token: string | null | undefined): void {
  useEffect(() => {
    if (!venueId || !token) return undefined;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      runPendingFiscalJobs(venueId, token);
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
  }, [venueId, token]);
}

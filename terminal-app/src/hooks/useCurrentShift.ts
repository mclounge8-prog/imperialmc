import { useCallback, useEffect, useState } from 'react';
import { fetchCurrentShift } from '../api/client';
import type { Shift } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useDevice } from '../context/DeviceContext';

// Общая загрузка текущей (открытой) смены заведения — используется ползунком
// смены и экраном «X-отчёт», у которых один и тот же источник данных, но
// разное представление/действия сверху.
export function useCurrentShift() {
  const { session } = useSession();
  const { status } = useDevice();
  const venue = status?.venue ?? null;

  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !venue) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCurrentShift(venue.id, session.token);
      setShift(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить данные смены');
    } finally {
      setLoading(false);
    }
  }, [session, venue]);

  useEffect(() => {
    load();
  }, [load]);

  return { session, venue, shift, setShift, loading, error, reload: load };
}

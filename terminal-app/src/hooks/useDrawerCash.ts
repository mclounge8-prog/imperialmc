import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { fetchCurrentShift } from '../api/client';
import { useDevice } from '../context/DeviceContext';
import { useSession } from '../context/SessionContext';
import { openDrawerCash, type DrawerCash } from '../utils/drawerCash';

const POLL_MS = 10000;

// Наличные открытой смены для шапки зала. Гостевой киоск эту шапку не монтирует.
// Повторный запрос не сбрасывает цифры, чтобы шапка не мигала.
export function useDrawerCash(): DrawerCash | null {
  const { session } = useSession();
  const { status } = useDevice();
  const route = useRoute();
  const venueId = status?.venue?.id ?? null;
  const token = session?.token ?? null;
  const [cash, setCash] = useState<DrawerCash | null>(null);

  const load = useCallback(async () => {
    if (!venueId || !token) {
      setCash(null);
      return;
    }
    try {
      const shift = await fetchCurrentShift(venueId, token);
      setCash(openDrawerCash(shift));
    } catch {
      // Сеть моргнула — оставляем последние суммы.
    }
  }, [venueId, token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load, route.name]);

  return cash;
}

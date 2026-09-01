import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerDevice as apiRegisterDevice, fetchDeviceStatus } from '../api/client';
import type { DeviceStatus } from '../api/client';

const STORAGE_KEY = 'imperial-mc:device-token';

type DeviceContextValue = {
  deviceToken: string | null;
  status: DeviceStatus | null;
  loading: boolean;
  error: string | null;
  register: (code: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Сбросить локальную привязку и снова показать экран ввода кода */
  clearRegistration: () => Promise<void>;
};

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

function isDeviceGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  if (status === 401) return true;
  const msg = error.message.toLowerCase();
  return msg.includes('удален') || msg.includes('не найден');
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearRegistration = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setDeviceToken(null);
    setStatus(null);
    setError(null);
  }, []);

  const checkStatus = useCallback(
    async (token: string) => {
      setError(null);
      try {
        const data = await fetchDeviceStatus(token);
        setStatus(data);
      } catch (e) {
        if (isDeviceGoneError(e)) {
          // Удалили в бэкофисе (или токен битый) — сбрасываем локально,
          // иначе планшет навсегда зависает на «устройство не найдено».
          await clearRegistration();
          return;
        }
        setError(e instanceof Error ? e.message : 'Не удалось проверить статус устройства');
      }
    },
    [clearRegistration]
  );

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then(async (raw) => {
        if (!isMounted || !raw) return;
        setDeviceToken(raw);
        await checkStatus(raw);
      })
      .catch(() => {
        // Хранилище недоступно — считаем устройство незарегистрированным,
        // экран регистрации в этом случае покажется снова, это безопасно
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [checkStatus]);

  const register = useCallback(
    async (code: string) => {
      const { token } = await apiRegisterDevice(code);
      await AsyncStorage.setItem(STORAGE_KEY, token);
      setError(null);
      setDeviceToken(token);
      await checkStatus(token);
    },
    [checkStatus]
  );

  const refresh = useCallback(async () => {
    if (!deviceToken) return;
    await checkStatus(deviceToken);
  }, [deviceToken, checkStatus]);

  return (
    <DeviceContext.Provider
      value={{
        deviceToken,
        status,
        loading,
        error,
        register,
        refresh,
        clearRegistration,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) {
    throw new Error('useDevice должен вызываться внутри DeviceProvider');
  }
  return ctx;
}

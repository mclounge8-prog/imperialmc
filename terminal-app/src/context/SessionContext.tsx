import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StaffLoginResponse } from '../api/client';

const SESSION_KEY = 'imperial_staff_session_v1';

type SessionContextValue = {
  session: StaffLoginResponse | null;
  /** true пока читаем сохранённую сессию с диска (после рестарта OTA/APK). */
  hydrating: boolean;
  login: (result: StaffLoginResponse) => void;
  logout: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function isValidSession(value: unknown): value is StaffLoginResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as StaffLoginResponse;
  return (
    typeof v.token === 'string' &&
    v.token.length > 0 &&
    !!v.staff &&
    typeof v.staff.id === 'number' &&
    typeof v.staff.name === 'string'
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffLoginResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as unknown;
        if (isValidSession(parsed)) {
          setSession(parsed);
        } else {
          await AsyncStorage.removeItem(SESSION_KEY);
        }
      } catch {
        // битый JSON — просто потребуем PIN снова
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((result: StaffLoginResponse) => {
    setSession(result);
    void AsyncStorage.setItem(SESSION_KEY, JSON.stringify(result));
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    void AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const value: SessionContextValue = {
    session,
    hydrating,
    login,
    logout,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession должен вызываться внутри SessionProvider');
  }
  return ctx;
}

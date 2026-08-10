import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { StaffLoginResponse } from '../api/client';

type SessionContextValue = {
  session: StaffLoginResponse | null;
  login: (result: StaffLoginResponse) => void;
  logout: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffLoginResponse | null>(null);

  const value: SessionContextValue = {
    session,
    login: setSession,
    logout: () => setSession(null),
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
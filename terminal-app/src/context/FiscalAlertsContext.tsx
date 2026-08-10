import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type FiscalAlert = {
  id: string;
  jobId?: number;
  title: string;
  message: string;
  createdAt: number;
};

type FiscalAlertsContextValue = {
  alerts: FiscalAlert[];
  errorCount: number;
  lastError: FiscalAlert | null;
  pushError: (alert: Omit<FiscalAlert, 'id' | 'createdAt'> & { id?: string }) => void;
  setServerErrorCount: (count: number) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
};

const FiscalAlertsContext = createContext<FiscalAlertsContextValue | undefined>(undefined);

let pushErrorExternal: FiscalAlertsContextValue['pushError'] | null = null;

/** Вызов из fiscalWorker (вне React-дерева) — безопасно, если провайдер ещё не смонтирован. */
export function notifyFiscalError(alert: Omit<FiscalAlert, 'id' | 'createdAt'> & { id?: string }): void {
  pushErrorExternal?.(alert);
}

export function FiscalAlertsProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<FiscalAlert[]>([]);
  const [serverErrorCount, setServerErrorCountState] = useState(0);

  const pushError = useCallback((alert: Omit<FiscalAlert, 'id' | 'createdAt'> & { id?: string }) => {
    const entry: FiscalAlert = {
      id: alert.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      jobId: alert.jobId,
      title: alert.title,
      message: alert.message,
      createdAt: Date.now(),
    };
    setAlerts((prev) => {
      const withoutDup = alert.jobId
        ? prev.filter((a) => a.jobId !== alert.jobId)
        : prev;
      return [entry, ...withoutDup].slice(0, 20);
    });
  }, []);

  pushErrorExternal = pushError;

  const setServerErrorCount = useCallback((count: number) => {
    setServerErrorCountState(Math.max(0, count));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const value = useMemo<FiscalAlertsContextValue>(() => {
    const errorCount = Math.max(serverErrorCount, alerts.length);
    return {
      alerts,
      errorCount,
      lastError: alerts[0] || null,
      pushError,
      setServerErrorCount,
      dismissAlert,
      clearAlerts,
    };
  }, [alerts, serverErrorCount, pushError, setServerErrorCount, dismissAlert, clearAlerts]);

  return <FiscalAlertsContext.Provider value={value}>{children}</FiscalAlertsContext.Provider>;
}

export function useFiscalAlerts(): FiscalAlertsContextValue {
  const ctx = useContext(FiscalAlertsContext);
  if (!ctx) {
    throw new Error('useFiscalAlerts должен вызываться внутри FiscalAlertsProvider');
  }
  return ctx;
}

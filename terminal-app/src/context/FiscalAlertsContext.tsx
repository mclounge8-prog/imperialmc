import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type FiscalAlert = {
  id: string;
  jobId?: number;
  title: string;
  message: string;
  /** atol = касса/очередь; server = связь с backend */
  kind: 'atol' | 'server';
  createdAt: number;
};

type FiscalAlertsContextValue = {
  alerts: FiscalAlert[];
  /** Ошибки фискальных заданий (серверный счётчик ∪ локальные ATOL-алерты). */
  errorCount: number;
  lastError: FiscalAlert | null;
  atolEnabled: boolean | null;
  pendingJobCount: number;
  serverOnline: boolean | null;
  serverMessage: string | null;
  pushError: (
    alert: Omit<FiscalAlert, 'id' | 'createdAt' | 'kind'> & { id?: string; kind?: 'atol' | 'server' }
  ) => void;
  setServerErrorCount: (count: number) => void;
  setAtolEnabled: (enabled: boolean | null) => void;
  setPendingJobCount: (count: number) => void;
  setServerOnline: (online: boolean, message?: string | null) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: (kind?: 'atol' | 'server') => void;
};

const FiscalAlertsContext = createContext<FiscalAlertsContextValue | undefined>(undefined);

let pushErrorExternal: FiscalAlertsContextValue['pushError'] | null = null;
let setServerOnlineExternal: FiscalAlertsContextValue['setServerOnline'] | null = null;

/** Вызов из fiscalWorker (вне React-дерева). */
export function notifyFiscalError(
  alert: Omit<FiscalAlert, 'id' | 'createdAt' | 'kind'> & { id?: string; kind?: 'atol' | 'server' }
): void {
  pushErrorExternal?.(alert);
}

export function notifyServerStatus(online: boolean, message?: string | null): void {
  setServerOnlineExternal?.(online, message);
}

export function FiscalAlertsProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<FiscalAlert[]>([]);
  const [serverErrorCount, setServerErrorCountState] = useState(0);
  const [atolEnabled, setAtolEnabledState] = useState<boolean | null>(null);
  const [pendingJobCount, setPendingJobCountState] = useState(0);
  const [serverOnline, setServerOnlineState] = useState<boolean | null>(null);
  const [serverMessage, setServerMessageState] = useState<string | null>(null);

  const pushError = useCallback(
    (alert: Omit<FiscalAlert, 'id' | 'createdAt' | 'kind'> & { id?: string; kind?: 'atol' | 'server' }) => {
      const kind = alert.kind || 'atol';
      const entry: FiscalAlert = {
        id: alert.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        jobId: alert.jobId,
        title: alert.title,
        message: alert.message,
        kind,
        createdAt: Date.now(),
      };
      setAlerts((prev) => {
        let next = prev;
        if (alert.jobId) {
          next = prev.filter((a) => a.jobId !== alert.jobId);
        } else if (kind === 'server') {
          next = prev.filter((a) => a.kind !== 'server');
        }
        return [entry, ...next].slice(0, 30);
      });
      if (kind === 'server') {
        setServerOnlineState(false);
        setServerMessageState(alert.message);
      }
    },
    []
  );

  pushErrorExternal = pushError;

  const setServerOnline = useCallback((online: boolean, message: string | null = null) => {
    setServerOnlineState(online);
    setServerMessageState(online ? null : message);
    if (online) {
      setAlerts((prev) => prev.filter((a) => a.kind !== 'server'));
    }
  }, []);

  setServerOnlineExternal = setServerOnline;

  const setServerErrorCount = useCallback((count: number) => {
    setServerErrorCountState(Math.max(0, count));
  }, []);

  const setAtolEnabled = useCallback((enabled: boolean | null) => {
    setAtolEnabledState(enabled);
  }, []);

  const setPendingJobCount = useCallback((count: number) => {
    setPendingJobCountState(Math.max(0, count));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAlerts = useCallback((kind?: 'atol' | 'server') => {
    if (!kind) {
      setAlerts([]);
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.kind !== kind));
  }, []);

  const value = useMemo<FiscalAlertsContextValue>(() => {
    const atolLocal = alerts.filter((a) => a.kind === 'atol');
    const errorCount = Math.max(serverErrorCount, atolLocal.length);
    return {
      alerts,
      errorCount,
      lastError: atolLocal[0] || alerts[0] || null,
      atolEnabled,
      pendingJobCount,
      serverOnline,
      serverMessage,
      pushError,
      setServerErrorCount,
      setAtolEnabled,
      setPendingJobCount,
      setServerOnline,
      dismissAlert,
      clearAlerts,
    };
  }, [
    alerts,
    serverErrorCount,
    atolEnabled,
    pendingJobCount,
    serverOnline,
    serverMessage,
    pushError,
    setServerErrorCount,
    setAtolEnabled,
    setPendingJobCount,
    setServerOnline,
    dismissAlert,
    clearAlerts,
  ]);

  return <FiscalAlertsContext.Provider value={value}>{children}</FiscalAlertsContext.Provider>;
}

export function useFiscalAlerts(): FiscalAlertsContextValue {
  const ctx = useContext(FiscalAlertsContext);
  if (!ctx) {
    throw new Error('useFiscalAlerts должен вызываться внутри FiscalAlertsProvider');
  }
  return ctx;
}

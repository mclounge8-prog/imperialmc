import { DeviceEventEmitter } from 'react-native';

/** Событие: staff JWT отвергнут сервером (401) — нужно заново войти по PIN. */
export const STAFF_UNAUTHORIZED_EVENT = 'imperial_staff_unauthorized';

export function emitStaffUnauthorized(reason?: string): void {
  DeviceEventEmitter.emit(STAFF_UNAUTHORIZED_EVENT, { reason: reason || 'Не авторизован' });
}

/** JWT payload без проверки подписи — только чтобы отсечь протухшие сессии на клиенте. */
export function readJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    if (typeof globalThis.atob !== 'function') return null;
    const payload = JSON.parse(globalThis.atob(padded)) as { exp?: number };
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, skewMs = 30_000): boolean {
  const expMs = readJwtExpMs(token);
  if (expMs == null) return false;
  return Date.now() >= expMs - skewMs;
}

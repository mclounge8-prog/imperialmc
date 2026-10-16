export const KITCHEN_WARN_MS = 15 * 60 * 1000;
export const KITCHEN_LIMIT_MS = 20 * 60 * 1000;

export type KitchenTimingState = 'ok' | 'warn' | 'late' | 'done';

const RANK: Record<KitchenTimingState, number> = {
  done: 0,
  ok: 1,
  warn: 2,
  late: 3,
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function kitchenFinishedAt(readyAt: string | null | undefined, itemReadyAts: Array<string | null | undefined>): number | null {
  const ticketAt = readyAt ? Date.parse(readyAt) : NaN;
  if (Number.isFinite(ticketAt)) return ticketAt;
  let latest = NaN;
  for (const value of itemReadyAts) {
    const at = value ? Date.parse(value) : NaN;
    if (Number.isFinite(at) && !(at < latest)) latest = at;
  }
  return Number.isFinite(latest) ? latest : null;
}

export function kitchenTiming(
  createdAtMs: number,
  nowMs: number,
  pending: boolean,
  readyAtMs: number | null = null
): { state: KitchenTimingState; label: string } {
  if (!pending) {
    if (readyAtMs == null || !Number.isFinite(readyAtMs) || !Number.isFinite(createdAtMs)) {
      return { state: 'done', label: 'готов' };
    }
    return { state: 'done', label: `готов за ${formatClock(Math.max(0, readyAtMs - createdAtMs))}` };
  }
  const age = Number.isFinite(createdAtMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - createdAtMs) : 0;
  const clock = formatClock(age);
  if (age >= KITCHEN_LIMIT_MS) return { state: 'late', label: `сверх 20 мин · ${clock}` };
  if (age >= KITCHEN_WARN_MS) return { state: 'warn', label: `время выходит · ${clock}` };
  return { state: 'ok', label: `осталось ${formatClock(KITCHEN_LIMIT_MS - age)}` };
}

export function moreUrgent(current: KitchenTimingState | undefined, next: KitchenTimingState): KitchenTimingState {
  if (!current || RANK[next] > RANK[current]) return next;
  return current;
}

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

export function kitchenTiming(
  createdAtMs: number,
  nowMs: number,
  pending: boolean
): { state: KitchenTimingState; label: string } {
  const age = Number.isFinite(createdAtMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - createdAtMs) : 0;
  const clock = formatClock(age);
  if (!pending) return { state: 'done', label: `готов за ${clock}` };
  if (age >= KITCHEN_LIMIT_MS) return { state: 'late', label: `сверх 20 мин · ${clock}` };
  if (age >= KITCHEN_WARN_MS) return { state: 'warn', label: `время выходит · ${clock}` };
  return { state: 'ok', label: `осталось ${formatClock(KITCHEN_LIMIT_MS - age)}` };
}

export function moreUrgent(current: KitchenTimingState | undefined, next: KitchenTimingState): KitchenTimingState {
  if (!current || RANK[next] > RANK[current]) return next;
  return current;
}

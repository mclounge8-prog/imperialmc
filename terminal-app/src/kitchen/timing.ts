export const KITCHEN_WARN_MS = 15 * 60 * 1000;
export const KITCHEN_LIMIT_MS = 20 * 60 * 1000;
// Готовый заказ остаётся на месте полторы минуты, потом уходит в низ списка.
export const KITCHEN_SINK_AFTER_MS = 90 * 1000;

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

export type KitchenListTicket = {
  readyAt: string | null;
  items: Array<{ ready: boolean; readyAt: string | null }>;
};

export function splitKitchenTickets<T extends KitchenListTicket>(
  tickets: T[],
  nowMs: number
): { active: T[]; sunk: T[] } {
  const active: T[] = [];
  const sunk: { ticket: T; readyAt: number }[] = [];
  for (const ticket of tickets) {
    const pending = ticket.items.some((item) => !item.ready);
    if (pending) {
      active.push(ticket);
      continue;
    }
    const readyAt = kitchenFinishedAt(
      ticket.readyAt,
      ticket.items.map((item) => item.readyAt)
    );
    if (readyAt == null || nowMs - readyAt < KITCHEN_SINK_AFTER_MS) active.push(ticket);
    else sunk.push({ ticket, readyAt });
  }
  sunk.sort((a, b) => b.readyAt - a.readyAt);
  return { active, sunk: sunk.map((entry) => entry.ticket) };
}

export function moreUrgent(current: KitchenTimingState | undefined, next: KitchenTimingState): KitchenTimingState {
  if (!current || RANK[next] > RANK[current]) return next;
  return current;
}

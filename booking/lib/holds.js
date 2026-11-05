const NIGHT_CUTOFF = 6 * 60;

export function startMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  let mins = hour * 60 + minute;
  if (mins < NIGHT_CUTOFF) mins += 24 * 60;
  return mins;
}

export function rangesOverlap(aTime, bTime, holdMinutes) {
  const a = startMinutes(aTime);
  const b = startMinutes(bTime);
  if (a == null || b == null) return false;
  const hold = Number(holdMinutes) || 0;
  return a < b + hold && b < a + hold;
}

export function seatsHeld(bookings, tableId, date, time, holdMinutes) {
  let held = 0;
  for (const booking of bookings) {
    if (Number(booking.tableId) !== Number(tableId)) continue;
    if (booking.date !== date) continue;
    if (booking.status === 'cancelled') continue;
    if (!rangesOverlap(booking.time, time, holdMinutes)) continue;
    held += Number(booking.guests) || 0;
  }
  return held;
}

export function canBook({ seats, held, guests, bookable }) {
  const party = Number(guests);
  const open = Number(seats) - Number(held);
  if (!bookable) return { ok: false, free: Math.max(0, open), reason: 'closed' };
  if (!Number.isInteger(party) || party < 1) return { ok: false, free: Math.max(0, open), reason: 'guests' };
  if (party > Number(seats)) return { ok: false, free: Math.max(0, open), reason: 'too_big' };
  if (party > open) return { ok: false, free: Math.max(0, open), reason: 'full' };
  return { ok: true, free: open, reason: null };
}

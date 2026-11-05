import { startMinutes } from './holds.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function clockMinutes(time) {
  const match = TIME_RE.exec(String(time || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(total) {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const minute = String(wrapped % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function sortTimes(times) {
  const unique = [];
  for (const time of times || []) {
    if (startMinutes(time) == null || unique.includes(time)) continue;
    unique.push(time);
  }
  unique.sort((a, b) => startMinutes(a) - startMinutes(b));
  return unique;
}

export function buildTimePool({ from, to, step }) {
  const start = clockMinutes(from);
  let end = clockMinutes(to);
  const gap = Number(step);
  if (start == null || end == null) return { ok: false, reason: 'time' };
  if (!Number.isInteger(gap) || gap < 5 || gap > 180) return { ok: false, reason: 'step' };
  if (end <= start) end += 24 * 60;
  const times = [];
  for (let cursor = start; cursor <= end; cursor += gap) {
    times.push(formatClock(cursor));
    if (times.length > 96) return { ok: false, reason: 'long' };
  }
  const last = formatClock(end);
  if (!times.includes(last)) times.push(last);
  return { ok: true, times: sortTimes(times) };
}

export function dateAllowed(date, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

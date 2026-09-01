/**
 * Часовой пояс точек (Екатеринбург, UTC+5).
 * Все отчёты, сутки «сегодня» и отображение closed_at — в этой зоне,
 * иначе чеки после полуночи попадают в «не тот» день UTC.
 */
export const VENUE_TIMEZONE = 'Asia/Yekaterinburg';

export function formatVenueDateTime(value, options = {}) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function formatVenueTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatVenueDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** YYYY-MM-DD в Asia/Yekaterinburg для «сегодня». */
export function venueTodayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Границы календарного дня venue TZ как Date (UTC-инстанты).
 * dateISO: 'YYYY-MM-DD' или null → сегодня в venue TZ.
 */
export function venueDayBounds(dateISO) {
  const day = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : venueTodayISO();
  // Полдень UTC-якорь + форматтер в зоне → точные границы через offset
  const start = venueZonedDateTime(day, 0, 0, 0);
  const end = venueZonedDateTime(day, 23, 59, 59, 999);
  return { day, start, end };
}

function venueZonedDateTime(dayISO, hour, minute, second = 0, ms = 0) {
  const [y, m, d] = dayISO.split('-').map(Number);
  // Ищем UTC-момент, который в Asia/Yekaterinburg равен указанному локальному времени
  const guess = Date.UTC(y, m - 1, d, hour - 5, minute, second, ms); // UTC+5 → сначала -5h
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtcLike = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const wanted = Date.UTC(y, m - 1, d, hour, minute, second, ms);
  const diff = wanted - asUtcLike;
  return new Date(guess + diff);
}

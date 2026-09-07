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

/** Сдвиг календарного дня YYYY-MM-DD в venue TZ на deltaDays (Екб без DST). */
export function venueShiftDaysISO(dayISO, deltaDays) {
  const day = dayISO && /^\d{4}-\d{2}-\d{2}$/.test(dayISO) ? dayISO : venueTodayISO();
  const noon = venueZonedDateTime(day, 12, 0, 0);
  return venueTodayISO(new Date(noon.getTime() + Number(deltaDays) * 86400000));
}

/**
 * Полуоткрытый день [start, end) в venue TZ — удобно для SQL/бакетов.
 * end = полночь следующего дня.
 */
export function venueDayRange(dateISO) {
  const day = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : venueTodayISO();
  const start = venueZonedDateTime(day, 0, 0, 0);
  const end = venueZonedDateTime(venueShiftDaysISO(day, 1), 0, 0, 0);
  return { day, start, end };
}

/** Час 0..23 в Asia/Yekaterinburg для момента времени. */
export function venueHour(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(d)
    .find((p) => p.type === 'hour')?.value;
  return Number(hourStr) || 0;
}

/** ISO weekday 1=Пн … 7=Вс в venue TZ. */
export function venueIsoWeekday(dayISO) {
  const day = dayISO && /^\d{4}-\d{2}-\d{2}$/.test(dayISO) ? dayISO : venueTodayISO();
  const { start } = venueDayBounds(day);
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TIMEZONE,
    weekday: 'short',
  }).format(start);
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] || 1;
}

export function venueMondayISO(dayISO) {
  const day = dayISO && /^\d{4}-\d{2}-\d{2}$/.test(dayISO) ? dayISO : venueTodayISO();
  return venueShiftDaysISO(day, -(venueIsoWeekday(day) - 1));
}

export function venueMonthStartISO(dayISO) {
  const day = dayISO && /^\d{4}-\d{2}-\d{2}$/.test(dayISO) ? dayISO : venueTodayISO();
  return `${day.slice(0, 7)}-01`;
}

export function venueQuarterStartISO(dayISO) {
  const day = dayISO && /^\d{4}-\d{2}-\d{2}$/.test(dayISO) ? dayISO : venueTodayISO();
  const [y, m] = day.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}

export function formatVenueDayShort(dayISO) {
  const { start } = venueDayBounds(dayISO);
  return start.toLocaleDateString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
  });
}

export function formatVenueMonthShort(dayISO) {
  const { start } = venueDayBounds(dayISO);
  return start.toLocaleDateString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    month: 'short',
    year: '2-digit',
  });
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

/**
 * Часовой пояс точек (Екатеринбург). Дублируем константу на терминале —
 * отдельный бандл, без импорта из backoffice.
 */
export const VENUE_TIMEZONE = 'Asia/Yekaterinburg';

export function formatVenueDateTime(value: string | Date | null | undefined): string {
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
  });
}

export function formatVenueTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    timeZone: VENUE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

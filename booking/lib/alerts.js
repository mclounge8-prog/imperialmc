import { setDefaultResultOrder } from 'node:dns';

const TITLES = {
  new: 'Новая бронь',
  reserved: 'Бронь подтверждена',
  paid: 'Оплата подтверждена',
  cancelled: 'Бронь отменена',
};

export function escapeTelegram(value) {
  return String(value ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`;
}

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

export function alertText(kind, booking) {
  const title = TITLES[kind] || 'Бронь';
  const date = String(booking.date || '').split('-').reverse().join('.');
  const lines = [
    `<b>${escapeTelegram(title)}</b>`,
    `${escapeTelegram(booking.table)} · ${escapeTelegram(booking.zone)}`,
    `${escapeTelegram(date)} · ${escapeTelegram(booking.time)}`,
    `${booking.guests} из ${booking.seats} мест`,
  ];
  const price = Number(booking.seatPrice) || 0;
  if (price > 0) lines.push(`${money(price)} за место · ${money(price * Number(booking.guests || 0))}`);
  lines.push(escapeTelegram(booking.name));
  lines.push(escapeTelegram(phone(booking.phone)));
  if (booking.comment) lines.push(escapeTelegram(booking.comment));
  return lines.join('\n');
}

export async function sendBookingAlert(kind, booking, config, fetchImpl = fetch) {
  if (!config?.botToken || !config?.chatId) return { ok: false, reason: 'unconfigured' };
  try { setDefaultResultOrder('ipv6first'); } catch { /* older runtimes */ }
  const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: alertText(kind, booking),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.description || `Telegram HTTP ${response.status}`);
    error.code = 'TELEGRAM_API_ERROR';
    throw error;
  }
  return { ok: true, messageId: data.result?.message_id || null };
}

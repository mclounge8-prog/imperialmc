import { pool } from '../db.js';

const SETTINGS_ID = 1;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatMoney(value) {
  const n = Number(value) || 0;
  return `${n.toFixed(2)} ₽`;
}

export function formatDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export async function ensureTelegramSettingsRow() {
  await pool.query(
    `INSERT INTO telegram_settings (id, enabled, bot_token, chat_id)
     VALUES ($1, false, NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SETTINGS_ID]
  );
}

export async function readTelegramSettings() {
  await ensureTelegramSettingsRow();
  const { rows } = await pool.query(
    'SELECT enabled, bot_token, chat_id, updated_at FROM telegram_settings WHERE id = $1',
    [SETTINGS_ID]
  );
  const row = rows[0] || {};
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const envEnabled = String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';

  const botToken = (row.bot_token || envToken || '').trim();
  const chatId = (row.chat_id || envChat || '').trim();
  const enabled = row.bot_token || row.chat_id ? !!row.enabled : envEnabled && !!botToken && !!chatId;

  return {
    enabled,
    botToken,
    chatId,
    updatedAt: row.updated_at || null,
    hasToken: Boolean(botToken),
    hasChatId: Boolean(chatId),
  };
}

export async function writeTelegramSettings({ enabled, botToken, chatId }) {
  await ensureTelegramSettingsRow();
  await pool.query(
    `UPDATE telegram_settings
     SET enabled = $2,
         bot_token = $3,
         chat_id = $4,
         updated_at = now()
     WHERE id = $1`,
    [SETTINGS_ID, !!enabled, botToken ? String(botToken).trim() : null, chatId ? String(chatId).trim() : null]
  );
  return readTelegramSettings();
}

export async function sendTelegramMessage(text, { parseMode = 'HTML', force = false } = {}) {
  const settings = await readTelegramSettings();
  if ((!settings.enabled && !force) || !settings.botToken || !settings.chatId) {
    return { skipped: true, reason: 'disabled_or_incomplete' };
  }

  // На сервере api.telegram.org часто доступен только по IPv6.
  try {
    const dns = await import('node:dns');
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv6first');
    }
  } catch {
    /* ignore */
  }

  const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || err?.message || 'network_error';
    const wrapped = new Error(`Не удалось связаться с api.telegram.org (${cause})`);
    wrapped.code = 'TELEGRAM_NETWORK_ERROR';
    throw wrapped;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const detail = data.description || `HTTP ${response.status}`;
    const err = new Error(`Telegram API: ${detail}`);
    err.code = 'TELEGRAM_API_ERROR';
    throw err;
  }
  return { ok: true, messageId: data.result?.message_id };
}

/** Не блокирует основной поток при сбое сети/бота. */
export function notifyTelegramSafe(buildTextPromiseOrFn) {
  Promise.resolve()
    .then(() => (typeof buildTextPromiseOrFn === 'function' ? buildTextPromiseOrFn() : buildTextPromiseOrFn))
    .then((text) => {
      if (!text) return null;
      return sendTelegramMessage(text);
    })
    .catch((err) => {
      console.error('[telegram]', err?.message || err);
    });
}

export async function fetchVenueName(venueId) {
  if (!venueId) return '—';
  const { rows } = await pool.query('SELECT name FROM venues WHERE id = $1', [venueId]);
  return rows[0]?.name || `Заведение #${venueId}`;
}

export async function fetchPreviousShiftClosingCash(venueId) {
  if (!venueId) return null;
  const { rows } = await pool.query(
    `SELECT closing_cash FROM shifts
     WHERE venue_id = $1 AND status = 'closed' AND closing_cash IS NOT NULL
     ORDER BY closed_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [venueId]
  );
  return rows[0] ? Number(rows[0].closing_cash) : null;
}

function header(title, venueName, when = new Date()) {
  return [
    `<b>${escapeHtml(title)}</b>`,
    `🏢 ${escapeHtml(venueName)}`,
    `🕒 ${escapeHtml(formatDateTime(when))}`,
  ].join('\n');
}

export function buildCashPaymentMessage({ venueName, amount, cashier, tableName, guestLabel, when }) {
  const where = [tableName ? `стол ${tableName}` : 'быстрый заказ', guestLabel].filter(Boolean).join(' · ');
  return [
    header('💵 Оплата наличными', venueName, when),
    '',
    `Сумма: <b>${escapeHtml(formatMoney(amount))}</b>`,
    `Кассир: ${escapeHtml(cashier || '—')}`,
    where ? `Чек: ${escapeHtml(where)}` : null,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildDiscountPaymentMessage({
  venueName,
  subtotal,
  discountPercent,
  discountAmount,
  total,
  payments,
  cashier,
  tableName,
  guestLabel,
  when,
}) {
  const where = [tableName ? `стол ${tableName}` : 'быстрый заказ', guestLabel].filter(Boolean).join(' · ');
  const methodLabels = { cash: 'наличные', card: 'безнал', other: 'прочее' };
  const payLines = (payments || [])
    .filter((p) => Number(p.amount) > 0.009)
    .map(
      (p) =>
        `${methodLabels[p.method] || p.method}: ${escapeHtml(formatMoney(p.amount))}`
    );
  return [
    header(`🏷 Скидка ${escapeHtml(String(discountPercent))}%`, venueName, when),
    '',
    `Сумма без скидки: ${escapeHtml(formatMoney(subtotal))}`,
    `Скидка: <b>−${escapeHtml(formatMoney(discountAmount))}</b> (${escapeHtml(String(discountPercent))}%)`,
    `К оплате: <b>${escapeHtml(formatMoney(total))}</b>`,
    payLines.length ? `Оплата: ${payLines.join(', ')}` : 'Оплата: не требуется (100%)',
    where ? `Чек: ${escapeHtml(where)}` : null,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildReceiptRefundMessage({
  venueName,
  receiptId,
  total,
  payments,
  cashier,
  tableName,
  guestLabel,
  when,
}) {
  const where = [tableName ? `стол ${tableName}` : 'быстрый заказ', guestLabel].filter(Boolean).join(' · ');
  const methodLabels = { cash: 'наличные', card: 'безнал', other: 'прочее' };
  const payLines = (payments || [])
    .filter((p) => Number(p.amount) > 0.009)
    .map(
      (p) =>
        `${methodLabels[p.method] || p.method}: ${escapeHtml(formatMoney(p.amount))}`
    );
  const hasCard = (payments || []).some((p) => p.method === 'card' && Number(p.amount) > 0.009);
  return [
    header('↩️ Возврат чека', venueName, when),
    '',
    `Чек №${escapeHtml(String(receiptId))}`,
    `Сумма возврата: <b>${escapeHtml(formatMoney(total))}</b>`,
    payLines.length ? `Способ: ${payLines.join(', ')}` : null,
    where ? `Где: ${escapeHtml(where)}` : null,
    `Кассир: ${escapeHtml(cashier || '—')}`,
    hasCard ? '⚠️ Безнал: возврат на банковском терминале сделайте отдельно' : null,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildShiftOpenMessage({
  venueName,
  openingCash,
  previousClosingCash,
  cashier,
  when,
}) {
  const prev = previousClosingCash == null ? null : Number(previousClosingCash);
  const open = Number(openingCash) || 0;
  const diff = prev == null ? null : open - prev;
  const lines = [
    header('🟢 Открытие смены', venueName, when),
    '',
    `Внесено при открытии: <b>${escapeHtml(formatMoney(open))}</b>`,
  ];
  if (prev == null) {
    lines.push('Предыдущая смена: нет данных о закрытии');
  } else {
    lines.push(`На закрытии прошлой смены: ${escapeHtml(formatMoney(prev))}`);
    lines.push(
      `Разница (открытие − прошлое закрытие): <b>${escapeHtml(formatMoney(diff))}</b>`
    );
  }
  lines.push(`Кассир: ${escapeHtml(cashier || '—')}`);
  return lines.join('\n');
}

export function buildShiftCloseMessage({
  venueName,
  closingCash,
  revenueTotal,
  cashSales,
  cardSales,
  receiptsCount,
  deposits,
  withdrawals,
  cashier,
  when,
  expectedCash,
}) {
  return [
    header('🔴 Закрытие смены', venueName, when),
    '',
    `Наличные при закрытии: <b>${escapeHtml(formatMoney(closingCash))}</b>`,
    expectedCash != null ? `Ожидалось по учёту: ${escapeHtml(formatMoney(expectedCash))}` : null,
    `Выручка: <b>${escapeHtml(formatMoney(revenueTotal))}</b>`,
    `Наличные оплаты: ${escapeHtml(formatMoney(cashSales))}`,
    `Безналичные оплаты: ${escapeHtml(formatMoney(cardSales))}`,
    `Чеков: ${escapeHtml(String(receiptsCount ?? 0))}`,
    `Инкассации: ${escapeHtml(formatMoney(withdrawals))}`,
    `Внесения: ${escapeHtml(formatMoney(deposits))}`,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildCashMovementMessage({ venueName, type, amount, comment, cashier, when }) {
  const isOut = type === 'withdrawal';
  const title = isOut ? '🏦 Инкассация' : '➕ Внесение наличности';
  return [
    header(title, venueName, when),
    '',
    `Сумма: <b>${escapeHtml(formatMoney(amount))}</b>`,
    comment ? `Комментарий: ${escapeHtml(comment)}` : null,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildPrecheckCancelMessage({
  venueName,
  comment,
  cashier,
  tableName,
  guestLabel,
  total,
  when,
}) {
  const where = [tableName ? `стол ${tableName}` : 'быстрый заказ', guestLabel].filter(Boolean).join(' · ');
  return [
    header('⚠️ Отмена пречека', venueName, when),
    '',
    `Комментарий: <b>${escapeHtml(comment || '—')}</b>`,
    `Сумма чека: ${escapeHtml(formatMoney(total))}`,
    where ? `Чек: ${escapeHtml(where)}` : null,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ]
    .filter((x) => x != null)
    .join('\n');
}

export function buildItemDeleteMessage({
  venueName,
  itemName,
  qtyRemoved,
  price,
  cashier,
  tableName,
  fullDelete,
  when,
}) {
  const where = tableName ? `стол ${tableName}` : 'быстрый заказ';
  return [
    header('🗑 Удаление позиции', venueName, when),
    '',
    `Позиция: <b>${escapeHtml(itemName)}</b>`,
    fullDelete
      ? `Удалено полностью: ${escapeHtml(String(qtyRemoved))} × ${escapeHtml(formatMoney(price))}`
      : `Убрано: ${escapeHtml(String(qtyRemoved))} × ${escapeHtml(formatMoney(price))}`,
    `Чек: ${escapeHtml(where)}`,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ].join('\n');
}

export function buildZeroCloseMessage({ venueName, cashier, tableName, guestLabel, when }) {
  const where = [tableName ? `стол ${tableName}` : 'быстрый заказ', guestLabel].filter(Boolean).join(' · ');
  return [
    header('0️⃣ Закрытие с 0 ₽', venueName, when),
    '',
    where ? `Чек: ${escapeHtml(where)}` : null,
    `Кассир: ${escapeHtml(cashier || '—')}`,
  ]
    .filter((x) => x != null)
    .join('\n');
}

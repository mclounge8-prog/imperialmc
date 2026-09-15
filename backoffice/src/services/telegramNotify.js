import { pool } from '../db.js';

const SETTINGS_ID = 1;
const DEFAULT_CHANNEL_KEY = 'mc_lounge';
/** Пауза между сообщениями в один chat — снижает 429 / антиспам Telegram. */
const SEND_GAP_MS = 700;
const MAX_RETRIES = 3;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureTelegramSettingsRow() {
  await pool.query(
    `INSERT INTO telegram_settings (id, enabled, bot_token, chat_id)
     VALUES ($1, false, NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SETTINGS_ID]
  );
}

export async function ensureTelegramChannels() {
  await pool.query(
    `INSERT INTO telegram_channels (key, name, enabled, bot_username)
     VALUES
       ('mc_lounge', 'MC Lounge (Роза + Puff)', true, NULL),
       ('kebab_king', 'Kebab King', true, 'imperialmckebabbot'),
       ('mc_grand', 'MC Гранд', true, 'imperialMC_grand_bot')
     ON CONFLICT (key) DO NOTHING`
  );
}

export async function readTelegramSettings() {
  await ensureTelegramSettingsRow();
  await ensureTelegramChannels();
  const { rows } = await pool.query(
    'SELECT enabled, bot_token, chat_id, updated_at FROM telegram_settings WHERE id = $1',
    [SETTINGS_ID]
  );
  const row = rows[0] || {};
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const envEnabled = String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';

  // Предпочитаем канал mc_lounge, если он уже заполнен.
  const lounge = await fetchTelegramChannelByKey(DEFAULT_CHANNEL_KEY);
  const botToken = (lounge?.botToken || row.bot_token || envToken || '').trim();
  const chatId = (lounge?.chatId || row.chat_id || envChat || '').trim();
  const enabled = lounge
    ? !!lounge.enabled && !!botToken && !!chatId
    : row.bot_token || row.chat_id
      ? !!row.enabled
      : envEnabled && !!botToken && !!chatId;

  return {
    enabled,
    botToken,
    chatId,
    updatedAt: lounge?.updatedAt || row.updated_at || null,
    hasToken: Boolean(botToken),
    hasChatId: Boolean(chatId),
  };
}

export async function writeTelegramSettings({ enabled, botToken, chatId }) {
  await ensureTelegramSettingsRow();
  await ensureTelegramChannels();
  const token = botToken ? String(botToken).trim() : null;
  const chat = chatId ? String(chatId).trim() : null;
  await pool.query(
    `UPDATE telegram_settings
     SET enabled = $2,
         bot_token = $3,
         chat_id = $4,
         updated_at = now()
     WHERE id = $1`,
    [SETTINGS_ID, !!enabled, token, chat]
  );
  await pool.query(
    `UPDATE telegram_channels
     SET enabled = $2,
         bot_token = COALESCE($3, bot_token),
         chat_id = COALESCE($4, chat_id),
         updated_at = now()
     WHERE key = $1`,
    [DEFAULT_CHANNEL_KEY, !!enabled, token, chat]
  );
  return readTelegramSettings();
}

function mapChannelRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    enabled: !!row.enabled,
    botToken: (row.bot_token || '').trim(),
    chatId: (row.chat_id || '').trim(),
    botUsername: row.bot_username || null,
    updatedAt: row.updated_at || null,
  };
}

export async function fetchTelegramChannelByKey(key) {
  await ensureTelegramChannels();
  const { rows } = await pool.query(
    `SELECT id, key, name, enabled, bot_token, chat_id, bot_username, updated_at
     FROM telegram_channels WHERE key = $1`,
    [key]
  );
  return mapChannelRow(rows[0]);
}

export async function listTelegramChannels() {
  await ensureTelegramChannels();
  const { rows } = await pool.query(
    `SELECT id, key, name, enabled, bot_token, chat_id, bot_username, updated_at
     FROM telegram_channels
     ORDER BY id`
  );
  return rows.map(mapChannelRow);
}

/** Каналы с названиями привязанных заведений — для экрана бэкофиса. */
export async function listTelegramChannelsWithVenues() {
  const channels = await listTelegramChannels();
  const { rows } = await pool.query(
    `SELECT cv.channel_id, v.id AS venue_id, v.name AS venue_name
     FROM telegram_channel_venues cv
     JOIN venues v ON v.id = cv.venue_id
     ORDER BY v.id`
  );
  const byChannel = new Map();
  for (const row of rows) {
    if (!byChannel.has(row.channel_id)) byChannel.set(row.channel_id, []);
    byChannel.get(row.channel_id).push({ id: row.venue_id, name: row.venue_name });
  }
  return channels.map((ch) => ({
    ...ch,
    venues: byChannel.get(ch.id) || [],
    hasToken: Boolean(ch.botToken),
    hasChatId: Boolean(ch.chatId),
  }));
}

/** Канал для заведения; если не привязан — MC Lounge / legacy. */
export async function resolveTelegramChannel({ venueId = null, channelKey = null } = {}) {
  await ensureTelegramChannels();

  if (channelKey) {
    const byKey = await fetchTelegramChannelByKey(channelKey);
    if (byKey) return byKey;
  }

  if (venueId) {
    const { rows } = await pool.query(
      `SELECT c.id, c.key, c.name, c.enabled, c.bot_token, c.chat_id, c.bot_username, c.updated_at
       FROM telegram_channel_venues cv
       JOIN telegram_channels c ON c.id = cv.channel_id
       WHERE cv.venue_id = $1
       LIMIT 1`,
      [venueId]
    );
    if (rows[0]) return mapChannelRow(rows[0]);
  }

  return fetchTelegramChannelByKey(DEFAULT_CHANNEL_KEY);
}

/** Очередь отправки по каналам — сообщения в один chat не бьют антиспам Telegram. */
const channelQueues = new Map();
const channelLastSentAt = new Map();

function enqueueChannelSend(channelKey, task) {
  const key = channelKey || DEFAULT_CHANNEL_KEY;
  const prev = channelQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => null)
    .then(async () => {
      const last = channelLastSentAt.get(key) || 0;
      const wait = SEND_GAP_MS - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        channelLastSentAt.set(key, Date.now());
      }
    });
  channelQueues.set(
    key,
    next.catch(() => null)
  );
  return next;
}

async function preferIpv6() {
  try {
    const dns = await import('node:dns');
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv6first');
    }
  } catch {
    /* ignore */
  }
}

async function deliverTelegramMessage(channel, text, { parseMode = 'HTML' } = {}) {
  await preferIpv6();
  const url = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel.chatId,
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
    if (response.ok && data.ok) {
      return { ok: true, messageId: data.result?.message_id, channelKey: channel.key };
    }

    const detail = data.description || `HTTP ${response.status}`;
    const retryAfter = Number(data.parameters?.retry_after);
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const pauseSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3 * attempt;
      console.warn(`[telegram] 429 on ${channel.key}, retry in ${pauseSec}s`);
      await sleep(pauseSec * 1000);
      continue;
    }

    const err = new Error(`Telegram API (${channel.key}): ${detail}`);
    err.code = 'TELEGRAM_API_ERROR';
    throw err;
  }
}

/**
 * Отправка в канал заведения (или явный channelKey / legacy MC Lounge).
 * Сообщения в один канал сериализуются с паузой.
 */
export async function sendTelegramMessage(
  text,
  { parseMode = 'HTML', force = false, venueId = null, channelKey = null } = {}
) {
  const channel = await resolveTelegramChannel({ venueId, channelKey });
  if (!channel) {
    return { skipped: true, reason: 'no_channel' };
  }
  if ((!channel.enabled && !force) || !channel.botToken || !channel.chatId) {
    return { skipped: true, reason: 'disabled_or_incomplete', channelKey: channel.key };
  }

  return enqueueChannelSend(channel.key, () =>
    deliverTelegramMessage(channel, text, { parseMode })
  );
}

/** Не блокирует основной поток при сбое сети/бота. */
export function notifyTelegramSafe(buildTextPromiseOrFn, opts = {}) {
  const venueId = opts.venueId ?? opts.venue_id ?? null;
  const channelKey = opts.channelKey ?? null;
  Promise.resolve()
    .then(() => (typeof buildTextPromiseOrFn === 'function' ? buildTextPromiseOrFn() : buildTextPromiseOrFn))
    .then((text) => {
      if (!text) return null;
      return sendTelegramMessage(text, { ...opts, venueId, channelKey });
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

function formatGrams(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} г`;
}

/** Алерт по учёту табака при закрытии смены — факт vs склад. */
export function buildTobaccoCountMessage({
  venueName,
  cashier,
  when,
  skipped,
  totalNetG,
  totalExpectedG,
  withinTolerance,
  toleranceG,
  lines,
}) {
  const linesOut = [
    header(skipped ? '⚠️ Табак · учёт пропущен' : '🍃 Табак · учёт смены', venueName, when),
    '',
  ];
  if (skipped) {
    linesOut.push('Подсчёт табака при закрытии смены <b>не выполнен</b>.');
    linesOut.push(`Кассир: ${escapeHtml(cashier || '—')}`);
    return linesOut.join('\n');
  }

  const ok = withinTolerance ? 'в допуске' : 'вне допуска';
  linesOut.push(
    `Итого чистый вес: <b>${escapeHtml(formatGrams(totalNetG))}</b>`,
    `Остаток по складу: <b>${escapeHtml(formatGrams(totalExpectedG))}</b>`,
    `Разница: <b>${escapeHtml(formatGrams(Number(totalNetG) - Number(totalExpectedG)))}</b> (${ok}, допуск ±${escapeHtml(formatGrams(toleranceG))})`,
    ''
  );
  for (const line of lines || []) {
    linesOut.push(
      `<b>${escapeHtml(line.tareLabel || line.brand || 'Тара')}</b> · банок ${escapeHtml(String(line.canQty ?? 0))}`,
      `  взвешено: ${escapeHtml(formatGrams(line.grossWeightG))} (− тара ${escapeHtml(formatGrams(line.tareWeightG))} × ${escapeHtml(String(line.canQty ?? 0))})`,
      `  чистое: ${escapeHtml(formatGrams(line.netWeightG))}`
    );
  }
  linesOut.push(`Кассир: ${escapeHtml(cashier || '—')}`);
  return linesOut.join('\n');
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

/** Алерт по приходу / списанию тары на точке. */
export function buildTobaccoTareMovementMessage({
  venueName,
  type,
  lines,
  comment,
  cashier,
  when,
}) {
  const isOut = type === 'writeoff';
  const title = isOut ? '📦 Тара · списание' : '📦 Тара · приход';
  const linesOut = [header(title, venueName, when), ''];
  const items = Array.isArray(lines) ? lines : [];
  if (!items.length) {
    linesOut.push('Позиции: —');
  } else {
    for (const line of items) {
      linesOut.push(
        `• <b>${escapeHtml(line.tareLabel || 'Тара')}</b> — ${escapeHtml(String(line.qty ?? 0))} шт`
      );
    }
    const totalQty = items.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    linesOut.push('', `Всего банок: <b>${escapeHtml(String(totalQty))}</b>`);
  }
  if (comment) linesOut.push(`Комментарий: ${escapeHtml(comment)}`);
  linesOut.push(`Кассир: ${escapeHtml(cashier || '—')}`);
  return linesOut.join('\n');
}

/** Алерт по списанию остатка табака (меласса) в граммах. */
export function buildTobaccoStockWriteoffMessage({
  venueName,
  amountG,
  stockBeforeG,
  stockAfterG,
  lines,
  comment,
  cashier,
  when,
}) {
  const linesOut = [
    header('🍃 Табак · списание остатка', venueName, when),
    '',
    `Списано: <b>${escapeHtml(formatGrams(amountG))}</b>`,
    `Остаток до: ${escapeHtml(formatGrams(stockBeforeG))} → после: <b>${escapeHtml(formatGrams(stockAfterG))}</b>`,
    '',
  ];
  for (const line of lines || []) {
    linesOut.push(
      `• ${escapeHtml(line.itemName || 'Позиция')}: −${escapeHtml(formatGrams(line.amountG))}`
    );
  }
  if (comment) linesOut.push('', `Комментарий: ${escapeHtml(comment)}`);
  linesOut.push(`Кассир: ${escapeHtml(cashier || '—')}`);
  return linesOut.join('\n');
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

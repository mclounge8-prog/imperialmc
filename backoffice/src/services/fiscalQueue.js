// Очередь фискальных заданий для кассы АТОЛ. Backend никогда не обращается
// к самой кассе — она находится в локальной сети конкретной точки, а не там,
// где крутится backend. Вместо этого backend только кладёт задания в очередь
// (fiscal_jobs), а выполняет их сам terminal-app.
import { pool } from '../db.js';

export async function fetchAtolSettings(venueId) {
  const { rows } = await pool.query('SELECT * FROM venue_atol_settings WHERE venue_id = $1', [
    venueId,
  ]);
  return rows[0] || null;
}

async function isAtolEnabledForVenue(client, venueId) {
  const { rows } = await client.query(
    'SELECT enabled FROM venue_atol_settings WHERE venue_id = $1',
    [venueId]
  );
  return !!(rows[0] && rows[0].enabled);
}

function buildSellTaskPayload({ items, payments, total, operatorName }) {
  const fiscalItems = applyDiscountToFiscalItems(items, total);
  return {
    type: 'sell',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
    items: fiscalItems.map((item) => ({
      type: 'position',
      name: item.name,
      price: Number(item.price),
      quantity: item.qty,
      amount: Math.round(Number(item.price) * item.qty * 100) / 100,
      measurementUnit: 0,
      paymentMethod: 'fullPayment',
      paymentObject: 'commodity',
    })),
    payments: payments.map((p) => ({
      type: p.method === 'cash' ? 'cash' : 'electronically',
      sum: Number(p.amount),
    })),
    total: Number(total),
  };
}

/** Пропорционально снижает цены позиций, чтобы sum(price*qty) == targetTotal (АТОЛ сверяет). */
export function applyDiscountToFiscalItems(items, targetTotal) {
  const list = Array.isArray(items) ? items : [];
  const target = Math.round(Number(targetTotal) * 100) / 100;
  const subtotal =
    Math.round(list.reduce((sum, i) => sum + Number(i.price) * Number(i.qty), 0) * 100) / 100;

  if (list.length === 0) return list;
  if (Math.abs(subtotal - target) < 0.005) {
    return list.map((i) => ({ ...i, price: Number(i.price) }));
  }
  if (target <= 0.009 || subtotal <= 0.009) {
    return list.map((i) => ({ ...i, price: 0 }));
  }

  const factor = target / subtotal;
  const scaled = list.map((i) => ({
    ...i,
    price: Math.round(Number(i.price) * factor * 100) / 100,
  }));

  let sum = Math.round(scaled.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0) * 100) / 100;
  const diff = Math.round((target - sum) * 100) / 100;
  if (Math.abs(diff) >= 0.01) {
    const last = scaled[scaled.length - 1];
    const qty = Number(last.qty) || 1;
    last.price = Math.round((Number(last.price) + diff / qty) * 100) / 100;
  }
  return scaled;
}

function buildOpenShiftPayload({ operatorName }) {
  return {
    type: 'openShift',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
  };
}

function buildCloseShiftPayload({ operatorName }) {
  return {
    type: 'closeShift',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
  };
}

// Учётные чеки внесения/выплаты наличных (нефискальные по смыслу ФФД,
// но печатаются кассой и двигают счётчик наличности в ККТ).
function buildCashInPayload({ amount, operatorName }) {
  return {
    type: 'cashIn',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
    cashSum: Number(amount),
  };
}

function buildCashOutPayload({ amount, operatorName }) {
  return {
    type: 'cashOut',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
    cashSum: Number(amount),
  };
}

/** Нефискальный пречек (счёт гостю) — без ФФД, только печать на ККТ. */
export function buildPrecheckPayload({
  items,
  total,
  subtotal,
  discountPercent = 0,
  discountAmount = 0,
  tableName,
  guestLabel,
  operatorName,
  venueName,
}) {
  const lines = [];
  lines.push({ type: 'text', text: '=== ПРЕДЧЕК ===', alignment: 'center' });
  lines.push({ type: 'text', text: 'НЕ ФИСКАЛЬНЫЙ ДОКУМЕНТ', alignment: 'center' });
  if (venueName) lines.push({ type: 'text', text: String(venueName), alignment: 'center' });
  lines.push({ type: 'text', text: '------------------------', alignment: 'center' });
  if (tableName) lines.push({ type: 'text', text: `Стол: ${tableName}` });
  if (guestLabel) lines.push({ type: 'text', text: `Чек: ${guestLabel}` });
  if (operatorName) lines.push({ type: 'text', text: `Официант: ${operatorName}` });
  lines.push({ type: 'text', text: '------------------------', alignment: 'center' });

  for (const item of items) {
    const price = Number(item.price);
    const qty = Number(item.qty);
    const lineTotal = Math.round(price * qty * 100) / 100;
    lines.push({
      type: 'text',
      text: `${item.name}`,
    });
    lines.push({
      type: 'text',
      text: `  ${qty} x ${price.toFixed(2)} = ${lineTotal.toFixed(2)}`,
    });
    for (const mod of item.modifiers || []) {
      const modPrice = Number(mod.price) || 0;
      if (modPrice > 0) {
        lines.push({ type: 'text', text: `  + ${mod.name} ${modPrice.toFixed(2)}` });
      } else {
        lines.push({ type: 'text', text: `  · ${mod.name}` });
      }
    }
  }

  lines.push({ type: 'text', text: '------------------------', alignment: 'center' });
  if (discountPercent > 0) {
    lines.push({
      type: 'text',
      text: `Сумма: ${Number(subtotal).toFixed(2)} руб.`,
      alignment: 'right',
    });
    lines.push({
      type: 'text',
      text: `Скидка ${discountPercent}%: −${Number(discountAmount).toFixed(2)} руб.`,
      alignment: 'right',
    });
  }
  lines.push({
    type: 'text',
    text: `ИТОГО: ${Number(total).toFixed(2)} руб.`,
    alignment: 'right',
  });
  lines.push({ type: 'text', text: ' ' });
  lines.push({ type: 'text', text: 'Ожидает оплату', alignment: 'center' });

  return {
    type: 'nonFiscal',
    items: lines,
  };
}

export async function enqueuePrecheckFiscalJob(
  client,
  {
    venueId,
    items,
    total,
    subtotal,
    discountPercent,
    discountAmount,
    tableName,
    guestLabel,
    operatorName,
    venueName,
  }
) {
  if (!venueId) return null;
  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) {
    // Пречек всё равно можно «выбить» логически (зафиксировать состав),
    // даже если касса выключена — печать просто не уйдёт в очередь.
    return null;
  }

  const payload = buildPrecheckPayload({
    items,
    total,
    subtotal,
    discountPercent,
    discountAmount,
    tableName,
    guestLabel,
    operatorName,
    venueName,
  });
  const { rows } = await client.query(
    `INSERT INTO fiscal_jobs (venue_id, type, payload) VALUES ($1, 'precheck', $2) RETURNING id`,
    [venueId, JSON.stringify(payload)]
  );
  return rows[0]?.id ?? null;
}

export async function enqueueReceiptFiscalJob(
  client,
  { venueId, receiptId, items, payments, total, operatorName }
) {
  if (!venueId) return;
  // Нулевая сумма (100% скидка) — фискальный sell не печатаем.
  if (Number(total) <= 0.009) {
    await client.query("UPDATE receipts SET fiscal_status = NULL WHERE id = $1", [receiptId]);
    return;
  }
  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) return;

  const payload = buildSellTaskPayload({ items, payments, total, operatorName });
  await client.query(
    `INSERT INTO fiscal_jobs (venue_id, type, receipt_id, payload) VALUES ($1, 'receipt', $2, $3)`,
    [venueId, receiptId, JSON.stringify(payload)]
  );
  await client.query("UPDATE receipts SET fiscal_status = 'pending' WHERE id = $1", [receiptId]);
}

export async function enqueueShiftFiscalJob(client, { venueId, shiftId, type, operatorName }) {
  if (!venueId) return;
  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) return;

  const payload =
    type === 'open_shift' ? buildOpenShiftPayload({ operatorName }) : buildCloseShiftPayload({ operatorName });

  await client.query(`INSERT INTO fiscal_jobs (venue_id, type, shift_id, payload) VALUES ($1, $2, $3, $4)`, [
    venueId,
    type,
    shiftId,
    JSON.stringify(payload),
  ]);
}

// type: 'cash_in' | 'cash_out'
export async function enqueueCashFiscalJob(client, { venueId, shiftId, type, amount, operatorName }) {
  if (!venueId) return;
  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum <= 0) return;

  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) return;

  const payload =
    type === 'cash_in'
      ? buildCashInPayload({ amount: sum, operatorName })
      : buildCashOutPayload({ amount: sum, operatorName });

  await client.query(
    `INSERT INTO fiscal_jobs (venue_id, type, shift_id, payload) VALUES ($1, $2, $3, $4)`,
    [venueId, type, shiftId || null, JSON.stringify(payload)]
  );
}

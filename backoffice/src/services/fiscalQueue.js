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
  return {
    type: 'sell',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
    items: items.map((item) => ({
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

export async function enqueueReceiptFiscalJob(
  client,
  { venueId, receiptId, items, payments, total, operatorName }
) {
  if (!venueId) return;
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

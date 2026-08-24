import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { enqueueReceiptReturnFiscalJob } from '../services/fiscalQueue.js';

const apiReceipts = new Hono();
apiReceipts.use('*', requireStaffToken);

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function loadReceiptDetail(id) {
  const { rows: receiptRows } = await pool.query(
    `SELECT id, venue_id, shift_id, table_name, guest_label, staff_name, total, subtotal,
            discount, discount_percent, closed_at, status, refunded_at, refunded_by_name,
            fiscal_status
     FROM receipts WHERE id = $1`,
    [id]
  );
  const receipt = receiptRows[0];
  if (!receipt) return null;

  const { rows: paymentRows } = await pool.query(
    `SELECT method, amount FROM receipt_payments WHERE receipt_id = $1 ORDER BY id`,
    [id]
  );

  const { rows: itemRows } = await pool.query(
    `SELECT id, menu_item_id, name, price, qty, line_total
     FROM receipt_items WHERE receipt_id = $1 ORDER BY id`,
    [id]
  );

  const items = [];
  for (const item of itemRows) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: modRows } = await pool.query(
      'SELECT modifier_id, name, price FROM receipt_item_modifiers WHERE receipt_item_id = $1 ORDER BY id',
      [item.id]
    );

    let removed = [];
    let added = [];
    if (item.menu_item_id) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: currentAttachments } = await pool.query(
        `SELECT mim.modifier_id, mim.is_default, m.name
         FROM menu_item_modifiers mim
         JOIN modifiers m ON m.id = mim.modifier_id
         WHERE mim.menu_item_id = $1`,
        [item.menu_item_id]
      );
      const appliedIds = new Set(modRows.map((m) => m.modifier_id).filter((v) => v !== null));
      removed = currentAttachments
        .filter((a) => a.is_default && !appliedIds.has(a.modifier_id))
        .map((a) => a.name);
      added = currentAttachments
        .filter((a) => !a.is_default && appliedIds.has(a.modifier_id))
        .map((a) => a.name);
    }

    items.push({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.name,
      price: Number(item.price),
      qty: item.qty,
      lineTotal: Number(item.line_total),
      modifiers: modRows.map((m) => ({
        modifierId: m.modifier_id,
        name: m.name,
        price: Number(m.price),
      })),
      removed,
      added,
    });
  }

  return {
    id: receipt.id,
    venueId: receipt.venue_id,
    shiftId: receipt.shift_id,
    tableName: receipt.table_name,
    guestLabel: receipt.guest_label,
    staffName: receipt.staff_name,
    total: Number(receipt.total),
    subtotal: Number(receipt.subtotal),
    discount: Number(receipt.discount),
    discountPercent: Number(receipt.discount_percent || 0),
    closedAt: receipt.closed_at,
    status: receipt.status,
    refundedAt: receipt.refunded_at,
    refundedByName: receipt.refunded_by_name,
    fiscalStatus: receipt.fiscal_status,
    payments: paymentRows.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
    })),
    items,
  };
}

async function applyStockDelta(client, venueId, warehouseItemId, deltaQty) {
  if (!venueId || !warehouseItemId || deltaQty === 0) return;
  await client.query(
    `INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
     VALUES ($1, $2, $3::numeric, 0)
     ON CONFLICT (venue_id, warehouse_item_id)
     DO UPDATE SET stock_qty = venue_warehouse_stock.stock_qty + $3::numeric`,
    [venueId, warehouseItemId, deltaQty]
  );
}

/** Возврат склада по текущим привязкам модификаторов каталога (best-effort). */
async function returnReceiptStock(client, venueId, items) {
  for (const item of items) {
    const qty = Number(item.qty) || 1;
    for (const mod of item.modifiers || []) {
      if (!mod.modifierId) continue;
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await client.query(
        `SELECT warehouse_item_id, qty FROM modifiers WHERE id = $1`,
        [mod.modifierId]
      );
      const row = rows[0];
      if (!row?.warehouse_item_id || Number(row.qty) <= 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyStockDelta(client, venueId, row.warehouse_item_id, Number(row.qty) * qty);
    }
  }
}

// Оплаченные чеки заведения за сегодня — переключатель «Оплаченные» на общем
// экране столов. В отличие от /api/shifts/receipts (которые только про
// текущую открытую смену), тут просто "что оплачено сегодня по этому
// заведению" — не зависит от того, открыта ли сейчас смена.
apiReceipts.get('/', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const todayStart = startOfUTCDay(new Date());
  const { rows } = await pool.query(
    `SELECT id, table_name, guest_label, staff_name, total, closed_at, status
     FROM receipts
     WHERE venue_id = $1
       AND status IN ('paid', 'refunded')
       AND closed_at >= $2
     ORDER BY closed_at DESC`,
    [venueId, todayStart.toISOString()]
  );

  const receipts = rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    guestLabel: r.guest_label,
    staffName: r.staff_name,
    total: Number(r.total),
    closedAt: r.closed_at,
    status: r.status,
  }));

  return c.json({ receipts });
});

apiReceipts.get('/:id', async (c) => {
  const detail = await loadReceiptDetail(c.req.param('id'));
  if (!detail) {
    c.status(404);
    return c.json({ error: 'Чек не найден' });
  }
  return c.json({ receipt: detail });
});

// Возврат уже оплаченного чека (нал и/или безнал). Требует открытую смену.
// Наличные вычитаются из ожидаемой кассы (paid → refunded), безнал — только
// учёт + sellReturn на ККТ (банковский терминал отдельный, его трогаем вручную).
apiReceipts.post('/:id/refund', async (c) => {
  const id = c.req.param('id');
  const staff = c.get('staff');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: receiptRows } = await client.query(
      `SELECT id, venue_id, shift_id, status, total, staff_name
       FROM receipts WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const receipt = receiptRows[0];
    if (!receipt) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Чек не найден' });
    }
    if (receipt.status === 'refunded') {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Чек уже возвращён' });
    }
    if (receipt.status !== 'paid') {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Вернуть можно только оплаченный чек' });
    }

    const { rows: shiftRows } = await client.query(
      "SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open' FOR UPDATE",
      [receipt.venue_id]
    );
    const openShift = shiftRows[0];
    if (!openShift) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({
        error: 'Для возврата нужна открытая смена',
        code: 'SHIFT_REQUIRED',
      });
    }

    const { rows: paymentRows } = await client.query(
      `SELECT method, amount FROM receipt_payments WHERE receipt_id = $1 ORDER BY id`,
      [id]
    );
    const payments = paymentRows
      .map((p) => ({ method: p.method, amount: Number(p.amount) }))
      .filter((p) => p.amount > 0.009);

    const { rows: itemRows } = await client.query(
      `SELECT id, menu_item_id, name, price, qty
       FROM receipt_items WHERE receipt_id = $1 ORDER BY id`,
      [id]
    );
    const items = [];
    for (const item of itemRows) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: modRows } = await client.query(
        'SELECT modifier_id, name, price FROM receipt_item_modifiers WHERE receipt_item_id = $1 ORDER BY id',
        [item.id]
      );
      items.push({
        menu_item_id: item.menu_item_id,
        name: item.name,
        price: Number(item.price),
        qty: Number(item.qty),
        modifiers: modRows.map((m) => ({
          modifierId: m.modifier_id,
          name: m.name,
          price: Number(m.price),
        })),
      });
    }

    await client.query(
      `UPDATE receipts
       SET status = 'refunded',
           refunded_at = now(),
           refunded_by = $2,
           refunded_by_name = $3
       WHERE id = $1`,
      [id, staff.sub, staff.name]
    );

    // Если чек был в другой (уже закрытой) смене — наличную часть отражаем
    // изъятием в текущей открытой смене, иначе ожидаемая касса не изменится.
    const cashAmount = roundMoney(
      payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
    );
    if (cashAmount > 0.009 && Number(receipt.shift_id) !== Number(openShift.id)) {
      await client.query(
        `INSERT INTO cash_movements (venue_id, shift_id, type, amount, comment, staff_id, staff_name)
         VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6)`,
        [
          receipt.venue_id,
          openShift.id,
          cashAmount,
          `Возврат чека #${id} (смена ${receipt.shift_id || '—'})`,
          staff.sub,
          staff.name,
        ]
      );
    }

    await returnReceiptStock(client, receipt.venue_id, items);

    await enqueueReceiptReturnFiscalJob(client, {
      venueId: receipt.venue_id,
      receiptId: Number(id),
      items,
      payments,
      total: Number(receipt.total),
      operatorName: staff.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[receipts/refund]', err);
    c.status(500);
    return c.json({ error: err.message || 'Не удалось оформить возврат' });
  } finally {
    client.release();
  }

  const detail = await loadReceiptDetail(id);
  return c.json({ receipt: detail, ok: true });
});

export default apiReceipts;

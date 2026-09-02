import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import {
  enqueueReceiptReturnFiscalJob,
  enqueueReceiptCopyFiscalJob,
} from '../services/fiscalQueue.js';
import {
  buildReceiptRefundMessage,
  fetchVenueName,
  notifyTelegramSafe,
} from '../services/telegramNotify.js';

const apiReceipts = new Hono();
apiReceipts.use('*', requireStaffToken);

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function loadReceiptDetail(id) {
  const { rows: receiptRows } = await pool.query(
    `SELECT id, venue_id, shift_id, table_name, guest_label, staff_name, total, subtotal,
            discount, discount_percent, closed_at, status, refunded_at, refunded_by_name,
            fiscal_status, fiscal_doc_number
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
    let defaultIds = new Set();
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
      defaultIds = new Set(
        currentAttachments.filter((a) => a.is_default).map((a) => a.modifier_id)
      );
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
      modifiers: modRows.map((m) => {
        const isDefault = m.modifier_id != null && defaultIds.has(m.modifier_id);
        return {
          modifierId: m.modifier_id,
          name: m.name,
          price: Number(m.price),
          isDefault,
        };
      }),
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
    fiscalDocNumber: receipt.fiscal_doc_number ?? null,
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

/** Возврат склада по снапшоту чека (то, что реально списывалось при добавлении). */
async function returnReceiptStock(client, venueId, items) {
  for (const item of items) {
    const itemQty = Number(item.qty) || 1;
    for (const mod of item.modifiers || []) {
      const warehouseItemId = mod.warehouse_item_id ?? mod.warehouseItemId ?? null;
      const perUnitQty = Number(mod.qty) || 0;
      if (!warehouseItemId || perUnitQty <= 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyStockDelta(client, venueId, warehouseItemId, perUnitQty * itemQty);
    }
  }
}

/**
 * Для старых чеков без warehouse/qty в receipt_item_modifiers —
 * подтягиваем расход из привязки блюда (qty_override) или каталога.
 */
async function enrichReceiptModifiersWithStockSnapshot(client, items) {
  for (const item of items) {
    for (const mod of item.modifiers || []) {
      if (mod.warehouse_item_id && Number(mod.qty) > 0) continue;
      if (!mod.modifier_id && !mod.modifierId) continue;
      const modifierId = mod.modifier_id ?? mod.modifierId;
      let warehouseItemId = mod.warehouse_item_id ?? null;
      let qty = Number(mod.qty) || 0;

      if (item.menu_item_id || item.menuItemId) {
        // eslint-disable-next-line no-await-in-loop
        const { rows } = await client.query(
          `SELECT m.warehouse_item_id,
                  COALESCE(mim.qty_override, m.qty) AS qty
           FROM modifiers m
           LEFT JOIN menu_item_modifiers mim
             ON mim.modifier_id = m.id AND mim.menu_item_id = $2
           WHERE m.id = $1`,
          [modifierId, item.menu_item_id ?? item.menuItemId]
        );
        if (rows[0]) {
          warehouseItemId = warehouseItemId || rows[0].warehouse_item_id;
          if (qty <= 0) qty = Number(rows[0].qty) || 0;
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const { rows } = await client.query(
          `SELECT warehouse_item_id, qty FROM modifiers WHERE id = $1`,
          [modifierId]
        );
        if (rows[0]) {
          warehouseItemId = warehouseItemId || rows[0].warehouse_item_id;
          if (qty <= 0) qty = Number(rows[0].qty) || 0;
        }
      }

      mod.warehouse_item_id = warehouseItemId;
      mod.qty = qty;
    }
  }
}

// Оплаченные чеки текущей открытой смены — вкладка «Оплаченные» на столах.
// Пока смена открыта, чеки видны; после закрытия смены список пуст
// (исторические чеки — в отчётах / экране чеков смены до закрытия).
apiReceipts.get('/', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows: shiftRows } = await pool.query(
    "SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open'",
    [venueId]
  );
  const openShift = shiftRows[0];
  if (!openShift) {
    return c.json({ receipts: [], shiftId: null });
  }

  const { rows } = await pool.query(
    `SELECT id, table_name, guest_label, staff_name, total, closed_at, status
     FROM receipts
     WHERE venue_id = $1
       AND shift_id = $2
       AND status IN ('paid', 'refunded')
     ORDER BY closed_at DESC`,
    [venueId, openShift.id]
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

  return c.json({ receipts, shiftId: openShift.id });
});

apiReceipts.get('/:id', async (c) => {
  const detail = await loadReceiptDetail(c.req.param('id'));
  if (!detail) {
    c.status(404);
    return c.json({ error: 'Чек не найден' });
  }
  return c.json({ receipt: detail });
});

/** Печать копии чека на ККТ (нефискальный документ с расшифровкой позиций и допов). */
apiReceipts.post('/:id/print-copy', async (c) => {
  const id = c.req.param('id');
  const staff = c.get('staff');
  const detail = await loadReceiptDetail(id);
  if (!detail) {
    c.status(404);
    return c.json({ error: 'Чек не найден' });
  }
  if (detail.status !== 'paid' && detail.status !== 'refunded') {
    c.status(409);
    return c.json({ error: 'Копию можно печатать только для оплаченного или возвращённого чека' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const venueName = await fetchVenueName(detail.venueId);
    const jobId = await enqueueReceiptCopyFiscalJob(client, {
      venueId: detail.venueId,
      receiptId: detail.id,
      items: detail.items.map((item) => ({
        name: item.name,
        price: item.price,
        qty: item.qty,
        modifiers: (item.modifiers || []).map((m) => ({
          name: m.name,
          price: m.price,
          isDefault: !!m.isDefault,
        })),
      })),
      payments: detail.payments,
      total: detail.total,
      subtotal: detail.subtotal,
      discountPercent: detail.discountPercent,
      discountAmount: detail.discount,
      tableName: detail.tableName,
      guestLabel: detail.guestLabel,
      operatorName: staff?.name || detail.staffName,
      venueName,
      closedAt: detail.closedAt,
      fiscalDocNumber: detail.fiscalDocNumber,
    });
    await client.query('COMMIT');
    if (!jobId) {
      c.status(409);
      return c.json({ error: 'Касса АТОЛ не включена для этого заведения' });
    }
    return c.json({ ok: true, jobId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[receipts/print-copy]', err);
    c.status(500);
    return c.json({ error: 'Не удалось поставить копию в очередь печати' });
  } finally {
    client.release();
  }
});

// Возврат уже оплаченного чека (нал и/или безнал). Требует открытую смену.
// Наличные вычитаются из ожидаемой кассы (paid → refunded), безнал — только
// учёт + sellReturn на ККТ (банковский терминал отдельный, его трогаем вручную).
apiReceipts.post('/:id/refund', async (c) => {
  const id = c.req.param('id');
  const staff = c.get('staff');

  let refundNotify = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: receiptRows } = await client.query(
      `SELECT id, venue_id, shift_id, status, total, staff_name, table_name, guest_label
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
        `SELECT rim.modifier_id, rim.name, rim.price, rim.warehouse_item_id, rim.qty,
                COALESCE(mim.is_default, false) AS is_default
         FROM receipt_item_modifiers rim
         LEFT JOIN menu_item_modifiers mim
           ON mim.menu_item_id = $2 AND mim.modifier_id = rim.modifier_id
         WHERE rim.receipt_item_id = $1
         ORDER BY rim.id`,
        [item.id, item.menu_item_id]
      );
      items.push({
        menu_item_id: item.menu_item_id,
        name: item.name,
        price: Number(item.price),
        qty: Number(item.qty),
        modifiers: modRows.map((m) => ({
          modifierId: m.modifier_id,
          modifier_id: m.modifier_id,
          name: m.name,
          price: Number(m.price),
          warehouse_item_id: m.warehouse_item_id,
          qty: Number(m.qty) || 0,
          is_default: !!m.is_default,
          isDefault: !!m.is_default,
        })),
      });
    }

    await enrichReceiptModifiersWithStockSnapshot(client, items);

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
    refundNotify = {
      venueId: receipt.venue_id,
      receiptId: Number(id),
      total: Number(receipt.total),
      payments,
      cashier: staff.name,
      tableName: receipt.table_name,
      guestLabel: receipt.guest_label,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[receipts/refund]', err);
    c.status(500);
    return c.json({ error: err.message || 'Не удалось оформить возврат' });
  } finally {
    client.release();
  }

  if (refundNotify) {
    notifyTelegramSafe(async () => {
      const venueName = await fetchVenueName(refundNotify.venueId);
      return buildReceiptRefundMessage({
        venueName,
        receiptId: refundNotify.receiptId,
        total: refundNotify.total,
        payments: refundNotify.payments,
        cashier: refundNotify.cashier,
        tableName: refundNotify.tableName,
        guestLabel: refundNotify.guestLabel,
      });
    });
  }

  const detail = await loadReceiptDetail(id);
  return c.json({ receipt: detail, ok: true });
});

export default apiReceipts;

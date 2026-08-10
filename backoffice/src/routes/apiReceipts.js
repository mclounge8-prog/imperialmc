import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';

const apiReceipts = new Hono();
apiReceipts.use('*', requireStaffToken);

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
    `SELECT id, table_name, guest_label, staff_name, total, closed_at
     FROM receipts
     WHERE venue_id = $1 AND status = 'paid' AND closed_at >= $2
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
  }));

  return c.json({ receipts });
});

// Полный состав оплаченного чека: позиции + модификаторы, с явным указанием,
// что убрано из состава по умолчанию, а что докуплено сверху — сравнение с
// ТЕКУЩИМИ настройками позиции меню (если её потом отредактировали в
// бэкофисе, сравнение становится приблизительным, но не ломается).
apiReceipts.get('/:id', async (c) => {
  const id = c.req.param('id');

  const { rows: receiptRows } = await pool.query(
    `SELECT id, table_name, guest_label, staff_name, total, closed_at, status
     FROM receipts WHERE id = $1`,
    [id]
  );
  const receipt = receiptRows[0];
  if (!receipt) {
    c.status(404);
    return c.json({ error: 'Чек не найден' });
  }

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
      modifiers: modRows.map((m) => ({ modifierId: m.modifier_id, name: m.name, price: Number(m.price) })),
      removed,
      added,
    });
  }

  return c.json({
    receipt: {
      id: receipt.id,
      tableName: receipt.table_name,
      guestLabel: receipt.guest_label,
      staffName: receipt.staff_name,
      total: Number(receipt.total),
      closedAt: receipt.closed_at,
      status: receipt.status,
      items,
    },
  });
});

export default apiReceipts;

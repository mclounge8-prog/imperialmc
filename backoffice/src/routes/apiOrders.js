import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { enqueuePrecheckFiscalJob, enqueueReceiptFiscalJob } from '../services/fiscalQueue.js';
import {
  buildCashPaymentMessage,
  buildDiscountPaymentMessage,
  buildItemDeleteMessage,
  buildPrecheckCancelMessage,
  buildZeroCloseMessage,
  fetchVenueName,
  notifyTelegramSafe,
} from '../services/telegramNotify.js';

const apiOrders = new Hono();

const ALLOWED_DISCOUNT_PERCENTS = new Set([0, 10, 15, 20, 25, 100]);

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseDiscountPercent(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || !ALLOWED_DISCOUNT_PERCENTS.has(n)) return null;
  return n;
}

async function fetchGuestPrecheckState(clientOrPool, guestId) {
  const { rows } = await clientOrPool.query(
    'SELECT precheck_printed_at FROM order_guests WHERE id = $1',
    [guestId]
  );
  return rows[0]?.precheck_printed_at || null;
}

async function assertGuestEditable(clientOrPool, guestId) {
  const printedAt = await fetchGuestPrecheckState(clientOrPool, guestId);
  if (printedAt) {
    const err = new Error(
      'Пречек уже напечатан — состав менять нельзя. Отмените чек с комментарием или проведите оплату.'
    );
    err.status = 409;
    err.code = 'PRECHECK_LOCKED';
    throw err;
  }
}

// Список всех открытых заказов заведения (столы + быстрые) — чтобы можно было
// вернуться в ранее открытый быстрый заказ, а не только в занятые столы
apiOrders.get('/orders/open', requireStaffToken, async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.table_id, t.name AS table_name,
            COALESCE((
              SELECT SUM(oi.price * oi.qty) FROM order_items oi
              JOIN order_guests og ON og.id = oi.guest_id
              WHERE oi.order_id = o.id AND og.status = 'open'
            ), 0) AS total
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     WHERE o.venue_id = $1 AND o.status = 'open'
     ORDER BY o.opened_at DESC`,
    [venueId]
  );

  const orders = rows.map((r) => ({
    id: r.id,
    tableId: r.table_id,
    tableName: r.table_name,
    total: Number(r.total),
  }));

  return c.json({ orders });
});

async function fetchOrderDetail(orderId) {
  const { rows: orderRows } = await pool.query(
    `SELECT o.id, o.status, o.table_id, o.venue_id, t.name AS table_name,
            COALESCE(v.precheck_enabled, false) AS precheck_enabled
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN venues v ON v.id = o.venue_id
     WHERE o.id = $1`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) return null;

  // Только открытые гости — оплаченный/закрытый гость пропадает из активного
  // списка на терминале, его чек уже рассчитан и к нему нечего добавлять
  const { rows: guestRows } = await pool.query(
    `SELECT id, label, precheck_printed_at, precheck_printed_by_name
     FROM order_guests
     WHERE order_id = $1 AND status = 'open'
     ORDER BY id`,
    [orderId]
  );

  const { rows: itemRows } = await pool.query(
    'SELECT id, guest_id, menu_item_id, name, price, qty FROM order_items WHERE order_id = $1 ORDER BY id',
    [orderId]
  );

  const itemsById = [];
  for (const item of itemRows) {
    // Модификаторы конкретно ЭТОЙ позиции заказа (снапшот на момент добавления) —
    // не общая рецептура блюда из каталога, а то, что реально выбрано: какие
    // ингредиенты сняты, какие платные добавки включены.
    // eslint-disable-next-line no-await-in-loop
    const { rows: modRows } = await pool.query(
      `SELECT oim.modifier_id, oim.name, oim.price, oim.qty, wi.unit
       FROM order_item_modifiers oim
       LEFT JOIN warehouse_items wi ON wi.id = oim.warehouse_item_id
       WHERE oim.order_item_id = $1
       ORDER BY oim.id`,
      [item.id]
    );
    const modifiers = modRows.map((r) => ({
      modifierId: r.modifier_id,
      name: r.name,
      price: Number(r.price),
      qty: Number(r.qty),
      unit: r.unit,
    }));
    itemsById.push({
      id: item.id,
      guestId: item.guest_id,
      menuItemId: item.menu_item_id,
      name: item.name,
      price: Number(item.price),
      qty: item.qty,
      lineTotal: Number(item.price) * item.qty,
      modifiers,
    });
  }

  const guests = guestRows.map((g) => {
    const guestItems = itemsById.filter((i) => i.guestId === g.id);
    const guestTotal = guestItems.reduce((sum, i) => sum + i.lineTotal, 0);
    return {
      id: g.id,
      label: g.label,
      items: guestItems.map(({ guestId, ...rest }) => rest),
      total: guestTotal,
      precheckPrintedAt: g.precheck_printed_at
        ? new Date(g.precheck_printed_at).toISOString()
        : null,
      precheckPrintedByName: g.precheck_printed_by_name || null,
    };
  });

  const total = guests.reduce((sum, g) => sum + g.total, 0);

  return {
    id: order.id,
    status: order.status,
    venueId: order.venue_id,
    precheckEnabled: !!order.precheck_enabled,
    table: order.table_id ? { id: order.table_id, name: order.table_name } : null,
    guests,
    total,
  };
}

async function createDefaultGuest(orderId) {
  await pool.query("INSERT INTO order_guests (order_id, label) VALUES ($1, 'Гость 1')", [orderId]);
}

// Если после оплаты/закрытия гостя открытых гостей в заказе больше не осталось —
// весь заказ (и стол, если был) закрывается сам. paid, если хотя бы один гость
// реально оплатил, иначе cancelled (все ушли без оплаты).
async function maybeCloseOrderIfAllGuestsSettled(orderId) {
  const { rows: openGuests } = await pool.query(
    "SELECT id FROM order_guests WHERE order_id = $1 AND status = 'open'",
    [orderId]
  );
  if (openGuests.length > 0) return;

  const { rows: paidGuests } = await pool.query(
    "SELECT id FROM order_guests WHERE order_id = $1 AND status = 'paid'",
    [orderId]
  );
  const finalStatus = paidGuests.length > 0 ? 'paid' : 'cancelled';

  const { rows: orderRows } = await pool.query(
    "UPDATE orders SET status = $1, closed_at = now() WHERE id = $2 AND status = 'open' RETURNING table_id",
    [finalStatus, orderId]
  );
  if (orderRows[0] && orderRows[0].table_id) {
    await pool.query("UPDATE tables SET status = 'free' WHERE id = $1", [orderRows[0].table_id]);
  }
}

// Получить текущий открытый заказ стола — создаёт его (с первым гостем), если ещё
// нет, и переводит стол в "занят". Заведение определяется через стол → зону → заведение.
apiOrders.get('/tables/:tableId/order', requireStaffToken, async (c) => {
  const tableId = c.req.param('tableId');
  const staff = c.get('staff');

  const { rows: tableRows } = await pool.query(
    `SELECT t.id, z.venue_id
     FROM tables t
     JOIN zones z ON z.id = t.zone_id
     WHERE t.id = $1`,
    [tableId]
  );
  const table = tableRows[0];
  if (!table) {
    c.status(404);
    return c.json({ error: 'Стол не найден' });
  }

  const { rows: existing } = await pool.query(
    "SELECT id FROM orders WHERE table_id = $1 AND status = 'open' LIMIT 1",
    [tableId]
  );

  let orderId;
  if (existing[0]) {
    orderId = existing[0].id;
  } else {
    const { rows: created } = await pool.query(
      "INSERT INTO orders (table_id, venue_id, status, opened_by) VALUES ($1, $2, 'open', $3) RETURNING id",
      [tableId, table.venue_id, staff.sub]
    );
    orderId = created[0].id;
    await createDefaultGuest(orderId);
    await pool.query("UPDATE tables SET status = 'occupied' WHERE id = $1", [tableId]);
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Быстрый заказ — не привязан к столу ("бесконечный стол"), заведение указывается явно
apiOrders.post('/orders/quick', requireStaffToken, async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;

  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows: created } = await pool.query(
    "INSERT INTO orders (table_id, venue_id, status, opened_by) VALUES (NULL, $1, 'open', $2) RETURNING id",
    [venueId, staff.sub]
  );
  await createDefaultGuest(created[0].id);

  const order = await fetchOrderDetail(created[0].id);
  return c.json({ order });
});

apiOrders.get('/orders/:orderId', requireStaffToken, async (c) => {
  const order = await fetchOrderDetail(c.req.param('orderId'));
  if (!order) {
    c.status(404);
    return c.json({ error: 'Заказ не найден' });
  }
  return c.json({ order });
});

// Добавить нового гостя (отдельный чек) в уже открытый заказ
apiOrders.post('/orders/:orderId/guests', requireStaffToken, async (c) => {
  const orderId = c.req.param('orderId');

  const { rows: orderRows } = await pool.query("SELECT id FROM orders WHERE id = $1 AND status = 'open'", [
    orderId,
  ]);
  if (!orderRows[0]) {
    c.status(409);
    return c.json({ error: 'Заказ закрыт или не найден' });
  }

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS count FROM order_guests WHERE order_id = $1',
    [orderId]
  );
  const nextNumber = Number(countRows[0].count) + 1;

  await pool.query('INSERT INTO order_guests (order_id, label) VALUES ($1, $2)', [
    orderId,
    `Гость ${nextNumber}`,
  ]);

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

const PAYMENT_METHODS = ['cash', 'card', 'other'];

async function fetchGuestForSettlement(orderId, guestId, client) {
  const { rows } = await client.query(
    `SELECT og.id, og.label, og.order_id, og.precheck_printed_at,
            o.venue_id, o.table_id, o.opened_at, t.name AS table_name,
            COALESCE(v.precheck_enabled, false) AS precheck_enabled,
            v.name AS venue_name
     FROM order_guests og
     JOIN orders o ON o.id = og.order_id
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN venues v ON v.id = o.venue_id
     WHERE og.id = $1 AND og.order_id = $2 AND og.status = 'open'
     FOR UPDATE OF og`,
    [guestId, orderId]
  );
  return rows[0] || null;
}

async function fetchGuestItemsSnapshot(guestId, client) {
  const { rows } = await client.query(
    `SELECT oi.id, oi.menu_item_id, oi.name, oi.price, oi.qty, mi.category_id, mc.name AS category_name
     FROM order_items oi
     LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
     LEFT JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE oi.guest_id = $1`,
    [guestId]
  );
  for (const item of rows) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: modRows } = await client.query(
      'SELECT modifier_id, name, price FROM order_item_modifiers WHERE order_item_id = $1 ORDER BY id',
      [item.id]
    );
    item.modifiers = modRows;
  }
  return rows;
}

// Текущая открытая смена заведения. Оплата и закрытие чека без смены запрещены.
async function fetchOpenShiftId(client, venueId) {
  if (!venueId) return null;
  const { rows } = await client.query("SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open'", [
    venueId,
  ]);
  return rows[0] ? rows[0].id : null;
}

async function requireOpenShiftId(client, venueId) {
  const shiftId = await fetchOpenShiftId(client, venueId);
  if (!shiftId) {
    const err = new Error('Смена не открыта — закрыть стол или провести оплату нельзя');
    err.status = 409;
    err.code = 'SHIFT_REQUIRED';
    throw err;
  }
  return shiftId;
}

async function createReceipt(
  client,
  { guest, staff, status, items, payments, cancelComment = null, discountPercent = 0 }
) {
  const subtotal = roundMoney(items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0));
  const pct = ALLOWED_DISCOUNT_PERCENTS.has(Number(discountPercent))
    ? Number(discountPercent)
    : 0;
  const discount = status === 'paid' ? roundMoney((subtotal * pct) / 100) : 0;
  const total = roundMoney(subtotal - discount);

  // Чек на 0 ₽ (пустой или 100% скидка) можно закрыть без открытой смены.
  const shiftId =
    total > 0.009
      ? await requireOpenShiftId(client, guest.venue_id)
      : await fetchOpenShiftId(client, guest.venue_id);

  const precheckWasPrinted = !!guest.precheck_printed_at;

  const { rows: receiptRows } = await client.query(
    `INSERT INTO receipts
       (venue_id, order_id, guest_id, table_id, table_name, guest_label,
        staff_id, staff_name, status, subtotal, discount, total, opened_at, closed_at, shift_id,
        cancel_comment, precheck_was_printed, discount_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15, $16, $17)
     RETURNING id`,
    [
      guest.venue_id,
      guest.order_id,
      guest.id,
      guest.table_id,
      guest.table_name,
      guest.label,
      staff.sub,
      staff.name,
      status,
      subtotal,
      discount,
      total,
      guest.opened_at,
      shiftId,
      status === 'cancelled' ? cancelComment : null,
      precheckWasPrinted,
      status === 'paid' ? pct : 0,
    ]
  );
  const receiptId = receiptRows[0].id;

  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: receiptItemRows } = await client.query(
      `INSERT INTO receipt_items (receipt_id, menu_item_id, name, category_id, category_name, price, qty, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        receiptId,
        item.menu_item_id,
        item.name,
        item.category_id,
        item.category_name,
        item.price,
        item.qty,
        Number(item.price) * item.qty,
      ]
    );
    const receiptItemId = receiptItemRows[0].id;

    for (const mod of item.modifiers || []) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        'INSERT INTO receipt_item_modifiers (receipt_item_id, modifier_id, name, price) VALUES ($1, $2, $3, $4)',
        [receiptItemId, mod.modifier_id, mod.name, mod.price]
      );
    }
  }

  for (const p of payments) {
    if (Number(p.amount) <= 0.009) continue;
    // eslint-disable-next-line no-await-in-loop
    await client.query('INSERT INTO receipt_payments (receipt_id, method, amount) VALUES ($1, $2, $3)', [
      receiptId,
      p.method,
      p.amount,
    ]);
  }

  // Фискализация — только для реально оплаченных чеков (cancelled — гость
  // ушёл не заплатив, денег не было, фискальный документ не нужен). Тихо
  // ничего не делает, если у заведения нет включённой кассы АТОЛ.
  // При скидке в АТОЛ уходят пропорционально сниженные цены позиций и итоговая сумма.
  if (status === 'paid') {
    await enqueueReceiptFiscalJob(client, {
      venueId: guest.venue_id,
      receiptId,
      items,
      payments: payments.filter((p) => Number(p.amount) > 0.009),
      total,
      operatorName: staff.name,
    });
  }

  return { receiptId, subtotal, discount, total, discountPercent: pct };
}

// Оплатить конкретного гостя (его отдельный чек), не трогая остальных. Требует
// способ(ы) оплаты — поддерживает разделённую оплату одним чеком (наличные + карта).
// Создаёт постоянную запись в receipts со снапшотом позиций и оплаты. Заказ
// (и стол) закрывается автоматически, только когда рассчитаны ВСЕ гости.
apiOrders.post('/orders/:orderId/guests/:guestId/pay', requireStaffToken, async (c) => {
  const { orderId, guestId } = c.req.param();
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const payments = body && Array.isArray(body.payments) ? body.payments : null;
  const discountPercent = parseDiscountPercent(
    body?.discount_percent ?? body?.discountPercent ?? 0
  );

  if (discountPercent == null) {
    c.status(400);
    return c.json({ error: 'Скидка должна быть одной из: 0, 10, 15, 20, 25, 100%' });
  }

  const client = await pool.connect();
  let paidNotify = null;
  try {
    await client.query('BEGIN');

    const guest = await fetchGuestForSettlement(orderId, guestId, client);
    if (!guest) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Гость не найден или уже закрыт' });
    }

    // В режиме пречека оплату разрешаем только после печати пречека (кроме 0 ₽).
    const items = await fetchGuestItemsSnapshot(guestId, client);
    const subtotal = roundMoney(items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0));
    const discount = roundMoney((subtotal * discountPercent) / 100);
    const payable = roundMoney(subtotal - discount);

    if (guest.precheck_enabled && subtotal > 0.009 && !guest.precheck_printed_at) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({
        error: 'Сначала напечатайте пречек, затем проводите оплату',
        code: 'PRECHECK_REQUIRED',
      });
    }

    let normalizedPayments = [];
    if (payable <= 0.009) {
      // 100% скидка или пустой чек — оплата не нужна.
      normalizedPayments = [];
    } else {
      if (!payments || payments.length === 0) {
        await client.query('ROLLBACK');
        c.status(400);
        return c.json({ error: 'Не указан способ оплаты' });
      }
      for (const p of payments) {
        if (!PAYMENT_METHODS.includes(p.method) || typeof p.amount !== 'number' || p.amount <= 0) {
          await client.query('ROLLBACK');
          c.status(400);
          return c.json({ error: 'Некорректные данные оплаты' });
        }
      }
      normalizedPayments = payments;
      const paymentsTotal = roundMoney(normalizedPayments.reduce((sum, p) => sum + p.amount, 0));
      if (Math.abs(paymentsTotal - payable) > 0.01) {
        await client.query('ROLLBACK');
        c.status(400);
        return c.json({
          error: `Сумма оплаты (${paymentsTotal.toFixed(2)}) не совпадает с суммой к оплате (${payable.toFixed(2)}${
            discountPercent ? `, скидка ${discountPercent}%` : ''
          })`,
        });
      }
    }

    const receiptMeta = await createReceipt(client, {
      guest,
      staff,
      status: 'paid',
      items,
      payments: normalizedPayments,
      discountPercent,
    });
    await client.query("UPDATE order_guests SET status = 'paid' WHERE id = $1", [guestId]);

    await client.query('COMMIT');
    paidNotify = {
      venueName: guest.venue_name,
      venueId: guest.venue_id,
      tableName: guest.table_name,
      guestLabel: guest.label,
      cashier: staff.name,
      cashAmount: normalizedPayments
        .filter((p) => p.method === 'cash')
        .reduce((sum, p) => sum + Number(p.amount), 0),
      discountPercent: receiptMeta.discountPercent,
      subtotal: receiptMeta.subtotal,
      discount: receiptMeta.discount,
      total: receiptMeta.total,
      payments: normalizedPayments,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && (err.code === 'SHIFT_REQUIRED' || err.code === 'PRECHECK_LOCKED')) {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }

  if (paidNotify) {
    const venueName = paidNotify.venueName || (await fetchVenueName(paidNotify.venueId));
    if (paidNotify.discountPercent > 0) {
      notifyTelegramSafe(
        buildDiscountPaymentMessage({
          venueName,
          subtotal: paidNotify.subtotal,
          discountPercent: paidNotify.discountPercent,
          discountAmount: paidNotify.discount,
          total: paidNotify.total,
          payments: paidNotify.payments,
          cashier: paidNotify.cashier,
          tableName: paidNotify.tableName,
          guestLabel: paidNotify.guestLabel,
        })
      );
    } else if (paidNotify.cashAmount > 0.009) {
      notifyTelegramSafe(
        buildCashPaymentMessage({
          venueName,
          amount: paidNotify.cashAmount,
          cashier: paidNotify.cashier,
          tableName: paidNotify.tableName,
          guestLabel: paidNotify.guestLabel,
        })
      );
    }
  }

  await maybeCloseOrderIfAllGuestsSettled(orderId);

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Закрыть чек гостя без оплаты (ушёл не заплатив/ошибка) — тоже создаёт запись
// в receipts (со статусом cancelled, без оплаты), чтобы такие случаи были видны
// в отчётах, а не просто исчезали бесследно. Не трогает остальных гостей заказа.
// После пречека комментарий обязателен.
apiOrders.post('/orders/:orderId/guests/:guestId/cancel', requireStaffToken, async (c) => {
  const { orderId, guestId } = c.req.param();
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const cancelComment =
    body && typeof body.comment === 'string' ? body.comment.trim() : '';

  let notifyPayload = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const guest = await fetchGuestForSettlement(orderId, guestId, client);
    if (!guest) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Гость не найден или уже закрыт' });
    }

    if (guest.precheck_printed_at && cancelComment.length < 3) {
      await client.query('ROLLBACK');
      c.status(400);
      return c.json({
        error: 'Укажите комментарий к отмене (после пречека это обязательно)',
        code: 'CANCEL_COMMENT_REQUIRED',
      });
    }

    const items = await fetchGuestItemsSnapshot(guestId, client);
    const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
    await createReceipt(client, {
      guest,
      staff,
      status: 'cancelled',
      items,
      payments: [],
      cancelComment: cancelComment || null,
    });
    await client.query("UPDATE order_guests SET status = 'cancelled' WHERE id = $1", [guestId]);

    await client.query('COMMIT');

    notifyPayload = {
      venueName: guest.venue_name,
      venueId: guest.venue_id,
      tableName: guest.table_name,
      guestLabel: guest.label,
      cashier: staff.name,
      comment: cancelComment,
      precheck: !!guest.precheck_printed_at,
      subtotal,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && (err.code === 'SHIFT_REQUIRED' || err.code === 'PRECHECK_LOCKED')) {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }

  if (notifyPayload) {
    const venueName =
      notifyPayload.venueName || (await fetchVenueName(notifyPayload.venueId));
    if (notifyPayload.precheck) {
      notifyTelegramSafe(
        buildPrecheckCancelMessage({
          venueName,
          comment: notifyPayload.comment,
          cashier: notifyPayload.cashier,
          tableName: notifyPayload.tableName,
          guestLabel: notifyPayload.guestLabel,
          total: notifyPayload.subtotal,
        })
      );
    } else if (notifyPayload.subtotal <= 0.009) {
      notifyTelegramSafe(
        buildZeroCloseMessage({
          venueName,
          cashier: notifyPayload.cashier,
          tableName: notifyPayload.tableName,
          guestLabel: notifyPayload.guestLabel,
        })
      );
    }
  }

  await maybeCloseOrderIfAllGuestsSettled(orderId);

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Печать пречека (нефискальный документ) + фиксация состава чека.
apiOrders.post('/orders/:orderId/guests/:guestId/precheck', requireStaffToken, async (c) => {
  const { orderId, guestId } = c.req.param();
  const staff = c.get('staff');

  const client = await pool.connect();
  let jobId = null;
  try {
    await client.query('BEGIN');

    const guest = await fetchGuestForSettlement(orderId, guestId, client);
    if (!guest) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Гость не найден или уже закрыт' });
    }
    if (!guest.precheck_enabled) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Режим пречека выключен для этого заведения', code: 'PRECHECK_DISABLED' });
    }
    if (guest.precheck_printed_at) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Пречек уже напечатан', code: 'PRECHECK_ALREADY' });
    }

    const items = await fetchGuestItemsSnapshot(guestId, client);
    const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
    if (subtotal <= 0.009) {
      await client.query('ROLLBACK');
      c.status(400);
      return c.json({ error: 'Нельзя напечатать пречек на пустой чек' });
    }

    await client.query(
      `UPDATE order_guests
       SET precheck_printed_at = now(),
           precheck_printed_by = $2,
           precheck_printed_by_name = $3
       WHERE id = $1`,
      [guestId, staff.sub, staff.name]
    );

    jobId = await enqueuePrecheckFiscalJob(client, {
      venueId: guest.venue_id,
      items,
      total: subtotal,
      tableName: guest.table_name,
      guestLabel: guest.label,
      operatorName: staff.name,
      venueName: guest.venue_name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order, fiscalJobId: jobId });
});

// ---------- Модификаторы позиции заказа: расчёт цены, ограничения групп,
// списание/возврат со склада заведения. Заменяет старую жёсткую рецептуру —
// состав каждой позиции теперь выбирается на месте, а не фиксирован раз и
// навсегда в каталоге. ----------

async function fetchMenuItemAttachmentsForOrder(client, menuItemId) {
  const { rows } = await client.query(
    `SELECT mim.modifier_id, mim.is_default,
            m.name, m.group_id, mg.name AS group_name, mg.min_select, mg.max_select,
            COALESCE(mim.price_override, m.price) AS price,
            COALESCE(mim.qty_override, m.qty) AS qty,
            m.warehouse_item_id
     FROM menu_item_modifiers mim
     JOIN modifiers m ON m.id = mim.modifier_id
     LEFT JOIN modifier_groups mg ON mg.id = m.group_id
     WHERE mim.menu_item_id = $1`,
    [menuItemId]
  );
  return rows;
}

async function fetchOrderItemModifierIds(client, orderItemId) {
  const { rows } = await client.query(
    'SELECT modifier_id FROM order_item_modifiers WHERE order_item_id = $1 AND modifier_id IS NOT NULL',
    [orderItemId]
  );
  return rows.map((r) => r.modifier_id);
}

async function fetchOrderItemModifierSnapshots(client, orderItemId) {
  const { rows } = await client.query(
    'SELECT warehouse_item_id, qty FROM order_item_modifiers WHERE order_item_id = $1',
    [orderItemId]
  );
  return rows;
}

// Одинаковый ли набор модификаторов (порядок не важен) — используется, чтобы
// решить, увеличивать ли количество у существующей строки заказа или завести
// новую (одна и та же позиция с РАЗНЫМ составом — это разные строки, у них
// разная цена и разный список для списания).
function sameModifierSet(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
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

async function deductModifiersStock(client, venueId, modifierSnapshots, multiplier) {
  for (const m of modifierSnapshots) {
    if (m.warehouse_item_id && Number(m.qty) > 0) {
      // eslint-disable-next-line no-await-in-loop
      await applyStockDelta(client, venueId, m.warehouse_item_id, -Number(m.qty) * multiplier);
    }
  }
}

async function returnModifiersStock(client, venueId, modifierSnapshots, multiplier) {
  for (const m of modifierSnapshots) {
    if (m.warehouse_item_id && Number(m.qty) > 0) {
      // eslint-disable-next-line no-await-in-loop
      await applyStockDelta(client, venueId, m.warehouse_item_id, Number(m.qty) * multiplier);
    }
  }
}

// Добавить позицию конкретному гостю. Принимает необязательный modifier_ids —
// список выбранных на терминале модификаторов (id из каталога modifiers).
// Если не передан — берутся модификаторы "по умолчанию" этой позиции (как
// раньше вела себя фиксированная рецептура). Увеличивает qty, если у этого же
// гостя уже есть точно такая же позиция с ТАКИМ ЖЕ составом; иначе — новая
// строка со своей ценой. Списывает со склада атомарно.
apiOrders.post('/orders/:orderId/items', requireStaffToken, async (c) => {
  const orderId = c.req.param('orderId');
  const body = await c.req.json().catch(() => null);
  const menuItemId = body && body.menu_item_id ? Number(body.menu_item_id) : null;
  const guestId = body && body.guest_id ? Number(body.guest_id) : null;
  const requestedModifierIds =
    body && Array.isArray(body.modifier_ids)
      ? body.modifier_ids.map(Number).filter((n) => Number.isFinite(n))
      : null;

  if (!menuItemId || !guestId) {
    c.status(400);
    return c.json({ error: 'Не указана позиция меню или гость' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      'SELECT id, status, venue_id FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (!orderRows[0] || orderRows[0].status !== 'open') {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Заказ уже закрыт' });
    }
    const venueId = orderRows[0].venue_id;

    await assertGuestEditable(client, guestId);

    const { rows: menuRows } = await client.query(
      'SELECT id, name, price FROM menu_items WHERE id = $1 AND is_active = true',
      [menuItemId]
    );
    if (!menuRows[0]) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Позиция меню не найдена' });
    }
    const menuItem = menuRows[0];

    const attachments = await fetchMenuItemAttachmentsForOrder(client, menuItemId);
    const attachmentByModifierId = new Map(attachments.map((a) => [a.modifier_id, a]));

    let selectedModifierIds;
    if (requestedModifierIds) {
      const hasInvalid = requestedModifierIds.some((id) => !attachmentByModifierId.has(id));
      if (hasInvalid) {
        await client.query('ROLLBACK');
        c.status(400);
        return c.json({ error: 'Выбран модификатор, не относящийся к этой позиции' });
      }
      selectedModifierIds = requestedModifierIds;
    } else {
      selectedModifierIds = attachments.filter((a) => a.is_default).map((a) => a.modifier_id);
    }

    // Ограничения групп (напр. "Лаваш" — ровно 1 вариант, "Соусы" — не больше 2)
    const countsByGroup = new Map();
    for (const modId of selectedModifierIds) {
      const groupId = attachmentByModifierId.get(modId).group_id;
      if (!groupId) continue;
      countsByGroup.set(groupId, (countsByGroup.get(groupId) || 0) + 1);
    }
    const groupsInvolved = new Map();
    for (const a of attachments) {
      if (a.group_id && !groupsInvolved.has(a.group_id)) {
        groupsInvolved.set(a.group_id, { name: a.group_name, min: a.min_select, max: a.max_select });
      }
    }
    for (const [groupId, info] of groupsInvolved) {
      const count = countsByGroup.get(groupId) || 0;
      if (info.max != null && count > info.max) {
        await client.query('ROLLBACK');
        c.status(400);
        return c.json({ error: `В группе «${info.name}» можно выбрать не больше ${info.max}` });
      }
      if (info.min > 0 && count < info.min) {
        await client.query('ROLLBACK');
        c.status(400);
        return c.json({ error: `В группе «${info.name}» нужно выбрать хотя бы ${info.min}` });
      }
    }

    const selectedAttachments = selectedModifierIds.map((id) => attachmentByModifierId.get(id));
    const extraPrice = selectedAttachments.reduce((sum, a) => sum + Number(a.price), 0);
    const unitPrice = Number(menuItem.price) + extraPrice;

    const { rows: candidateItems } = await client.query(
      'SELECT id FROM order_items WHERE order_id = $1 AND guest_id = $2 AND menu_item_id = $3',
      [orderId, guestId, menuItemId]
    );
    let matchedItemId = null;
    for (const candidate of candidateItems) {
      // eslint-disable-next-line no-await-in-loop
      const existingIds = await fetchOrderItemModifierIds(client, candidate.id);
      if (sameModifierSet(existingIds, selectedModifierIds)) {
        matchedItemId = candidate.id;
        break;
      }
    }

    if (matchedItemId) {
      await client.query('UPDATE order_items SET qty = qty + 1 WHERE id = $1', [matchedItemId]);
    } else {
      const { rows: inserted } = await client.query(
        'INSERT INTO order_items (order_id, guest_id, menu_item_id, name, price, qty) VALUES ($1, $2, $3, $4, $5, 1) RETURNING id',
        [orderId, guestId, menuItemId, menuItem.name, unitPrice]
      );
      const newItemId = inserted[0].id;
      for (const a of selectedAttachments) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO order_item_modifiers (order_item_id, modifier_id, name, price, warehouse_item_id, qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newItemId, a.modifier_id, a.name, a.price, a.warehouse_item_id, a.qty]
        );
      }
    }

    if (venueId) {
      await deductModifiersStock(client, venueId, selectedAttachments, 1);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === 'PRECHECK_LOCKED') {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Перенести позицию к другому гостю. Если у целевого гостя уже есть такая же
// позиция меню — количества складываются, а не дублируются отдельной строкой.
apiOrders.put('/orders/:orderId/items/:itemId/guest', requireStaffToken, async (c) => {
  const { orderId, itemId } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const targetGuestId = body && body.guest_id ? Number(body.guest_id) : null;

  if (!targetGuestId) {
    c.status(400);
    return c.json({ error: 'Не указан гость' });
  }

  try {
    const { rows: itemRows } = await pool.query(
      'SELECT id, menu_item_id, qty, guest_id FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );
    const item = itemRows[0];
    if (!item) {
      c.status(404);
      return c.json({ error: 'Позиция не найдена' });
    }

    await assertGuestEditable(pool, item.guest_id);
    await assertGuestEditable(pool, targetGuestId);

    if (item.menu_item_id) {
      const itemModifierIds = await fetchOrderItemModifierIds(pool, item.id);
      const { rows: existing } = await pool.query(
        'SELECT id, qty FROM order_items WHERE order_id = $1 AND guest_id = $2 AND menu_item_id = $3 AND id != $4',
        [orderId, targetGuestId, item.menu_item_id, itemId]
      );
      let matched = null;
      for (const candidate of existing) {
        // eslint-disable-next-line no-await-in-loop
        const candidateModifierIds = await fetchOrderItemModifierIds(pool, candidate.id);
        if (sameModifierSet(candidateModifierIds, itemModifierIds)) {
          matched = candidate;
          break;
        }
      }
      if (matched) {
        await pool.query('UPDATE order_items SET qty = qty + $1 WHERE id = $2', [item.qty, matched.id]);
        await pool.query('DELETE FROM order_items WHERE id = $1', [itemId]);
      } else {
        await pool.query('UPDATE order_items SET guest_id = $1 WHERE id = $2', [targetGuestId, itemId]);
      }
    } else {
      await pool.query('UPDATE order_items SET guest_id = $1 WHERE id = $2', [targetGuestId, itemId]);
    }
  } catch (err) {
    if (err && err.code === 'PRECHECK_LOCKED') {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Убрать одну единицу позиции — возвращает списанное сырьё обратно на склад заведения
apiOrders.delete('/orders/:orderId/items/:itemId', requireStaffToken, async (c) => {
  const { orderId, itemId } = c.req.param();
  const staff = c.get('staff');

  const client = await pool.connect();
  let deleteNotify = null;
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT o.venue_id, o.table_id, t.name AS table_name, v.name AS venue_name
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN venues v ON v.id = o.venue_id
       WHERE o.id = $1`,
      [orderId]
    );
    const venueId = orderRows[0] ? orderRows[0].venue_id : null;

    const { rows: itemRows } = await client.query(
      'SELECT id, menu_item_id, name, price, qty, guest_id FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [itemId, orderId]
    );
    const item = itemRows[0];
    if (!item) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Позиция не найдена в заказе' });
    }

    await assertGuestEditable(client, item.guest_id);

    if (item.menu_item_id && venueId) {
      const modifierSnapshots = await fetchOrderItemModifierSnapshots(client, item.id);
      await returnModifiersStock(client, venueId, modifierSnapshots, 1);
    }

    const fullDelete = item.qty <= 1;
    if (item.qty > 1) {
      await client.query('UPDATE order_items SET qty = qty - 1 WHERE id = $1', [item.id]);
    } else {
      await client.query('DELETE FROM order_items WHERE id = $1', [item.id]);
    }

    await client.query('COMMIT');
    deleteNotify = {
      venueName: orderRows[0]?.venue_name,
      venueId,
      tableName: orderRows[0]?.table_name,
      itemName: item.name,
      price: Number(item.price),
      qtyRemoved: fullDelete ? item.qty : 1,
      fullDelete,
      cashier: staff.name,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === 'PRECHECK_LOCKED') {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }

  if (deleteNotify) {
    const venueName = deleteNotify.venueName || (await fetchVenueName(deleteNotify.venueId));
    notifyTelegramSafe(
      buildItemDeleteMessage({
        venueName,
        itemName: deleteNotify.itemName,
        qtyRemoved: deleteNotify.qtyRemoved,
        price: deleteNotify.price,
        cashier: deleteNotify.cashier,
        tableName: deleteNotify.tableName,
        fullDelete: deleteNotify.fullDelete,
      })
    );
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Убрать позицию из чека ПОЛНОСТЬЮ, независимо от количества — возвращает на склад
// весь списанный объём (qty × рецептура), а не одну порцию
apiOrders.delete('/orders/:orderId/items/:itemId/full', requireStaffToken, async (c) => {
  const { orderId, itemId } = c.req.param();
  const staff = c.get('staff');

  const client = await pool.connect();
  let deleteNotify = null;
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT o.venue_id, o.table_id, t.name AS table_name, v.name AS venue_name
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN venues v ON v.id = o.venue_id
       WHERE o.id = $1`,
      [orderId]
    );
    const venueId = orderRows[0] ? orderRows[0].venue_id : null;

    const { rows: itemRows } = await client.query(
      'SELECT id, menu_item_id, name, price, qty, guest_id FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [itemId, orderId]
    );
    const item = itemRows[0];
    if (!item) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Позиция не найдена в заказе' });
    }

    await assertGuestEditable(client, item.guest_id);

    if (item.menu_item_id && venueId) {
      const modifierSnapshots = await fetchOrderItemModifierSnapshots(client, item.id);
      await returnModifiersStock(client, venueId, modifierSnapshots, item.qty);
    }

    await client.query('DELETE FROM order_items WHERE id = $1', [item.id]);

    await client.query('COMMIT');
    deleteNotify = {
      venueName: orderRows[0]?.venue_name,
      venueId,
      tableName: orderRows[0]?.table_name,
      itemName: item.name,
      price: Number(item.price),
      qtyRemoved: item.qty,
      fullDelete: true,
      cashier: staff.name,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === 'PRECHECK_LOCKED') {
      c.status(err.status || 409);
      return c.json({ error: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }

  if (deleteNotify) {
    const venueName = deleteNotify.venueName || (await fetchVenueName(deleteNotify.venueId));
    notifyTelegramSafe(
      buildItemDeleteMessage({
        venueName,
        itemName: deleteNotify.itemName,
        qtyRemoved: deleteNotify.qtyRemoved,
        price: deleteNotify.price,
        cashier: deleteNotify.cashier,
        tableName: deleteNotify.tableName,
        fullDelete: true,
      })
    );
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Пересадка: переносит весь заказ (все чеки/позиции) на другой стол, включая смену
// зоны — старый стол освобождается, новый занимается. Быстрые заказы не пересаживаются
// (у них нет стола, к которому это применимо).
apiOrders.put('/orders/:orderId/table', requireStaffToken, async (c) => {
  const orderId = c.req.param('orderId');
  const body = await c.req.json().catch(() => null);
  const newTableId = body && body.table_id ? Number(body.table_id) : null;

  if (!newTableId) {
    c.status(400);
    return c.json({ error: 'Не указан новый стол' });
  }

  const { rows: orderRows } = await pool.query(
    "SELECT id, table_id, venue_id FROM orders WHERE id = $1 AND status = 'open'",
    [orderId]
  );
  const order = orderRows[0];
  if (!order) {
    c.status(404);
    return c.json({ error: 'Заказ не найден или уже закрыт' });
  }
  if (!order.table_id) {
    c.status(400);
    return c.json({ error: 'Пересадка доступна только для заказов, привязанных к столу' });
  }

  const { rows: newTableRows } = await pool.query(
    `SELECT t.id, t.status, z.venue_id
     FROM tables t
     JOIN zones z ON z.id = t.zone_id
     WHERE t.id = $1`,
    [newTableId]
  );
  const newTable = newTableRows[0];
  if (!newTable) {
    c.status(404);
    return c.json({ error: 'Стол не найден' });
  }
  if (newTable.venue_id !== order.venue_id) {
    c.status(400);
    return c.json({ error: 'Стол принадлежит другому заведению' });
  }
  if (newTable.id !== order.table_id && newTable.status === 'occupied') {
    c.status(409);
    return c.json({ error: 'Этот стол уже занят' });
  }

  const oldTableId = order.table_id;
  await pool.query('UPDATE orders SET table_id = $1 WHERE id = $2', [newTableId, orderId]);
  if (oldTableId !== newTableId) {
    await pool.query("UPDATE tables SET status = 'free' WHERE id = $1", [oldTableId]);
    await pool.query("UPDATE tables SET status = 'occupied' WHERE id = $1", [newTableId]);
  }

  const updated = await fetchOrderDetail(orderId);
  return c.json({ order: updated });
});

export default apiOrders;

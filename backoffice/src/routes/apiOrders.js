import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';

const apiOrders = new Hono();

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
    `SELECT o.id, o.status, o.table_id, o.venue_id, t.name AS table_name
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     WHERE o.id = $1`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) return null;

  // Только открытые гости — оплаченный/закрытый гость пропадает из активного
  // списка на терминале, его чек уже рассчитан и к нему нечего добавлять
  const { rows: guestRows } = await pool.query(
    "SELECT id, label FROM order_guests WHERE order_id = $1 AND status = 'open' ORDER BY id",
    [orderId]
  );

  const { rows: itemRows } = await pool.query(
    'SELECT id, guest_id, menu_item_id, name, price, qty FROM order_items WHERE order_id = $1 ORDER BY id',
    [orderId]
  );

  const itemsById = [];
  for (const item of itemRows) {
    let recipe = [];
    if (item.menu_item_id) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: recipeRows } = await pool.query(
        `SELECT wi.name, mir.qty, wi.unit
         FROM menu_item_recipe mir
         JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id
         WHERE mir.menu_item_id = $1`,
        [item.menu_item_id]
      );
      recipe = recipeRows.map((r) => ({ name: r.name, qty: Number(r.qty), unit: r.unit }));
    }
    itemsById.push({
      id: item.id,
      guestId: item.guest_id,
      menuItemId: item.menu_item_id,
      name: item.name,
      price: Number(item.price),
      qty: item.qty,
      lineTotal: Number(item.price) * item.qty,
      recipe,
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
    };
  });

  const total = guests.reduce((sum, g) => sum + g.total, 0);

  return {
    id: order.id,
    status: order.status,
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
    `SELECT og.id, og.label, og.order_id, o.venue_id, o.table_id, o.opened_at, t.name AS table_name
     FROM order_guests og
     JOIN orders o ON o.id = og.order_id
     LEFT JOIN tables t ON t.id = o.table_id
     WHERE og.id = $1 AND og.order_id = $2 AND og.status = 'open'
     FOR UPDATE OF og`,
    [guestId, orderId]
  );
  return rows[0] || null;
}

async function fetchGuestItemsSnapshot(guestId, client) {
  const { rows } = await client.query(
    `SELECT oi.menu_item_id, oi.name, oi.price, oi.qty, mi.category_id, mc.name AS category_name
     FROM order_items oi
     LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
     LEFT JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE oi.guest_id = $1`,
    [guestId]
  );
  return rows;
}

async function createReceipt(client, { guest, staff, status, items, payments }) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);

  const { rows: receiptRows } = await client.query(
    `INSERT INTO receipts
       (venue_id, order_id, guest_id, table_id, table_name, guest_label,
        staff_id, staff_name, status, subtotal, discount, total, opened_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $10, $11, now())
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
      guest.opened_at,
    ]
  );
  const receiptId = receiptRows[0].id;

  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO receipt_items (receipt_id, menu_item_id, name, category_id, category_name, price, qty, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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
  }

  for (const p of payments) {
    // eslint-disable-next-line no-await-in-loop
    await client.query('INSERT INTO receipt_payments (receipt_id, method, amount) VALUES ($1, $2, $3)', [
      receiptId,
      p.method,
      p.amount,
    ]);
  }

  return receiptId;
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

  if (!payments || payments.length === 0) {
    c.status(400);
    return c.json({ error: 'Не указан способ оплаты' });
  }
  for (const p of payments) {
    if (!PAYMENT_METHODS.includes(p.method) || typeof p.amount !== 'number' || p.amount <= 0) {
      c.status(400);
      return c.json({ error: 'Некорректные данные оплаты' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const guest = await fetchGuestForSettlement(orderId, guestId, client);
    if (!guest) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Гость не найден или уже закрыт' });
    }

    const items = await fetchGuestItemsSnapshot(guestId, client);
    const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
    const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);

    if (Math.abs(paymentsTotal - subtotal) > 0.01) {
      await client.query('ROLLBACK');
      c.status(400);
      return c.json({
        error: `Сумма оплаты (${paymentsTotal.toFixed(2)}) не совпадает с суммой чека (${subtotal.toFixed(2)})`,
      });
    }

    await createReceipt(client, { guest, staff, status: 'paid', items, payments });
    await client.query("UPDATE order_guests SET status = 'paid' WHERE id = $1", [guestId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await maybeCloseOrderIfAllGuestsSettled(orderId);

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Закрыть чек гостя без оплаты (ушёл не заплатив/ошибка) — тоже создаёт запись
// в receipts (со статусом cancelled, без оплаты), чтобы такие случаи были видны
// в отчётах, а не просто исчезали бесследно. Не трогает остальных гостей заказа.
apiOrders.post('/orders/:orderId/guests/:guestId/cancel', requireStaffToken, async (c) => {
  const { orderId, guestId } = c.req.param();
  const staff = c.get('staff');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const guest = await fetchGuestForSettlement(orderId, guestId, client);
    if (!guest) {
      await client.query('ROLLBACK');
      c.status(409);
      return c.json({ error: 'Гость не найден или уже закрыт' });
    }

    const items = await fetchGuestItemsSnapshot(guestId, client);
    await createReceipt(client, { guest, staff, status: 'cancelled', items, payments: [] });
    await client.query("UPDATE order_guests SET status = 'cancelled' WHERE id = $1", [guestId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await maybeCloseOrderIfAllGuestsSettled(orderId);

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Добавить позицию конкретному гостю: увеличивает qty, если у этого же гостя уже есть
// такая позиция; списывает рецептуру со склада заведения — атомарно
apiOrders.post('/orders/:orderId/items', requireStaffToken, async (c) => {
  const orderId = c.req.param('orderId');
  const body = await c.req.json().catch(() => null);
  const menuItemId = body && body.menu_item_id ? Number(body.menu_item_id) : null;
  const guestId = body && body.guest_id ? Number(body.guest_id) : null;

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

    const { rows: existingItem } = await client.query(
      'SELECT id, qty FROM order_items WHERE order_id = $1 AND guest_id = $2 AND menu_item_id = $3',
      [orderId, guestId, menuItemId]
    );

    if (existingItem[0]) {
      await client.query('UPDATE order_items SET qty = qty + 1 WHERE id = $1', [existingItem[0].id]);
    } else {
      await client.query(
        'INSERT INTO order_items (order_id, guest_id, menu_item_id, name, price, qty) VALUES ($1, $2, $3, $4, $5, 1)',
        [orderId, guestId, menuItemId, menuItem.name, menuItem.price]
      );
    }

    if (venueId) {
      const { rows: recipeRows } = await client.query(
        'SELECT warehouse_item_id, qty FROM menu_item_recipe WHERE menu_item_id = $1',
        [menuItemId]
      );
      for (const r of recipeRows) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
           VALUES ($1, $2, -$3::numeric, 0)
           ON CONFLICT (venue_id, warehouse_item_id)
           DO UPDATE SET stock_qty = venue_warehouse_stock.stock_qty - $3::numeric`,
          [venueId, r.warehouse_item_id, r.qty]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
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

  const { rows: itemRows } = await pool.query(
    'SELECT id, menu_item_id, qty FROM order_items WHERE id = $1 AND order_id = $2',
    [itemId, orderId]
  );
  const item = itemRows[0];
  if (!item) {
    c.status(404);
    return c.json({ error: 'Позиция не найдена' });
  }

  if (item.menu_item_id) {
    const { rows: existing } = await pool.query(
      'SELECT id, qty FROM order_items WHERE order_id = $1 AND guest_id = $2 AND menu_item_id = $3 AND id != $4',
      [orderId, targetGuestId, item.menu_item_id, itemId]
    );
    if (existing[0]) {
      await pool.query('UPDATE order_items SET qty = qty + $1 WHERE id = $2', [item.qty, existing[0].id]);
      await pool.query('DELETE FROM order_items WHERE id = $1', [itemId]);
    } else {
      await pool.query('UPDATE order_items SET guest_id = $1 WHERE id = $2', [targetGuestId, itemId]);
    }
  } else {
    await pool.query('UPDATE order_items SET guest_id = $1 WHERE id = $2', [targetGuestId, itemId]);
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Убрать одну единицу позиции — возвращает списанное сырьё обратно на склад заведения
apiOrders.delete('/orders/:orderId/items/:itemId', requireStaffToken, async (c) => {
  const { orderId, itemId } = c.req.param();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query('SELECT venue_id FROM orders WHERE id = $1', [
      orderId,
    ]);
    const venueId = orderRows[0] ? orderRows[0].venue_id : null;

    const { rows: itemRows } = await client.query(
      'SELECT id, menu_item_id, qty FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [itemId, orderId]
    );
    const item = itemRows[0];
    if (!item) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Позиция не найдена в заказе' });
    }

    if (item.menu_item_id && venueId) {
      const { rows: recipeRows } = await client.query(
        'SELECT warehouse_item_id, qty FROM menu_item_recipe WHERE menu_item_id = $1',
        [item.menu_item_id]
      );
      for (const r of recipeRows) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
           VALUES ($1, $2, $3::numeric, 0)
           ON CONFLICT (venue_id, warehouse_item_id)
           DO UPDATE SET stock_qty = venue_warehouse_stock.stock_qty + $3::numeric`,
          [venueId, r.warehouse_item_id, r.qty]
        );
      }
    }

    if (item.qty > 1) {
      await client.query('UPDATE order_items SET qty = qty - 1 WHERE id = $1', [item.id]);
    } else {
      await client.query('DELETE FROM order_items WHERE id = $1', [item.id]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const order = await fetchOrderDetail(orderId);
  return c.json({ order });
});

// Убрать позицию из чека ПОЛНОСТЬЮ, независимо от количества — возвращает на склад
// весь списанный объём (qty × рецептура), а не одну порцию
apiOrders.delete('/orders/:orderId/items/:itemId/full', requireStaffToken, async (c) => {
  const { orderId, itemId } = c.req.param();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query('SELECT venue_id FROM orders WHERE id = $1', [
      orderId,
    ]);
    const venueId = orderRows[0] ? orderRows[0].venue_id : null;

    const { rows: itemRows } = await client.query(
      'SELECT id, menu_item_id, qty FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [itemId, orderId]
    );
    const item = itemRows[0];
    if (!item) {
      await client.query('ROLLBACK');
      c.status(404);
      return c.json({ error: 'Позиция не найдена в заказе' });
    }

    if (item.menu_item_id && venueId) {
      const { rows: recipeRows } = await client.query(
        'SELECT warehouse_item_id, qty FROM menu_item_recipe WHERE menu_item_id = $1',
        [item.menu_item_id]
      );
      for (const r of recipeRows) {
        const totalQty = Number(r.qty) * item.qty;
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
           VALUES ($1, $2, $3::numeric, 0)
           ON CONFLICT (venue_id, warehouse_item_id)
           DO UPDATE SET stock_qty = venue_warehouse_stock.stock_qty + $3::numeric`,
          [venueId, r.warehouse_item_id, totalQty]
        );
      }
    }

    await client.query('DELETE FROM order_items WHERE id = $1', [item.id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
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

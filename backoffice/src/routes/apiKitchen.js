import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { findDeviceByToken } from '../middleware/deviceAuth.js';
import { withTableDimensions } from '../tableSizes.js';

const apiKitchen = new Hono();

function sendError(c, status, error, code) {
  c.status(status);
  return c.json({ error, code });
}

async function kitchenVenues() {
  const { rows } = await pool.query(
    `SELECT v.id, v.name,
            EXISTS (
              SELECT 1 FROM shifts s
              WHERE s.venue_id = v.id AND s.status = 'open'
            ) AS shift_open
     FROM venues v
     WHERE EXISTS (
       SELECT 1 FROM devices d
       WHERE d.venue_id = v.id
         AND d.is_active = true
         AND COALESCE(d.kitchen_enabled, false) = true
     )
     ORDER BY v.name`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    shiftOpen: !!row.shift_open,
  }));
}

async function loadBoard(venueId) {
  const { rows: venueRows } = await pool.query(
    'SELECT id, name FROM venues WHERE id = $1',
    [venueId]
  );
  const venue = venueRows[0];
  if (!venue) return null;

  const { rows: shiftRows } = await pool.query(
    "SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open'",
    [venueId]
  );

  const { rows: zones } = await pool.query(
    'SELECT id, name FROM zones WHERE venue_id = $1 ORDER BY sort_order ASC, id ASC',
    [venueId]
  );
  const { rows: tableRows } = await pool.query(
    `SELECT t.id, t.zone_id, t.name, t.capacity, t.status, t.pos_x, t.pos_y, t.width, t.height, t.size
     FROM tables t
     JOIN zones z ON z.id = t.zone_id
     WHERE z.venue_id = $1
     ORDER BY t.id`,
    [venueId]
  );

  const { rows: ticketRows } = await pool.query(
    `SELECT kt.id, kt.order_id, kt.guest_id, kt.table_id, kt.status, kt.created_at, kt.ready_at,
            t.name AS table_name, og.label AS guest_label
     FROM kitchen_tickets kt
     JOIN orders o ON o.id = kt.order_id AND o.status = 'open'
     JOIN order_guests og ON og.id = kt.guest_id AND og.status = 'open'
     LEFT JOIN tables t ON t.id = kt.table_id
     WHERE kt.venue_id = $1 AND kt.status IN ('new', 'ready')
     ORDER BY kt.created_at ASC`,
    [venueId]
  );

  const ticketIds = ticketRows.map((row) => row.id);
  let itemRows = [];
  if (ticketIds.length) {
    const items = await pool.query(
      `SELECT id, ticket_id, name, qty, modifiers, serve_in, ready_at
       FROM kitchen_ticket_items
       WHERE ticket_id = ANY($1::int[])
       ORDER BY id`,
      [ticketIds]
    );
    itemRows = items.rows;
  }

  const itemsByTicket = new Map();
  for (const item of itemRows) {
    const list = itemsByTicket.get(item.ticket_id) || [];
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    list.push({
      id: item.id,
      name: item.name,
      qty: Number(item.qty),
      ready: item.ready_at != null,
      readyAt: item.ready_at ? new Date(item.ready_at).toISOString() : null,
      serveIn: item.serve_in || null,
      modifiers: modifiers.map((mod) => ({
        name: mod.name,
        qty: Number(mod.qty) || 0,
        unit: mod.unit || null,
      })),
    });
    itemsByTicket.set(item.ticket_id, list);
  }

  return {
    venueId: venue.id,
    venueName: venue.name,
    shiftOpen: shiftRows.length > 0,
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      tables: tableRows
        .filter((table) => table.zone_id === zone.id)
        .map((table) => {
          const normalized = withTableDimensions(table);
          return {
            id: normalized.id,
            name: normalized.name,
            capacity: normalized.capacity,
            status: normalized.status,
            posX: normalized.pos_x,
            posY: normalized.pos_y,
            size: normalized.size,
            width: normalized.width,
            height: normalized.height,
          };
        }),
    })),
    tickets: ticketRows.map((ticket) => ({
      id: ticket.id,
      orderId: ticket.order_id,
      guestId: ticket.guest_id,
      guestLabel: ticket.guest_label,
      tableId: ticket.table_id,
      tableName: ticket.table_name || 'Быстрый заказ',
      status: ticket.status,
      createdAt: new Date(ticket.created_at).toISOString(),
      readyAt: ticket.ready_at ? new Date(ticket.ready_at).toISOString() : null,
      items: itemsByTicket.get(ticket.id) || [],
    })),
  };
}

// Экран кухни без авторизации: данные только с терминала, где включили кухню,
// и только пока у этого заведения открыта смена (закрытая смена видна как пустой зал).
apiKitchen.get('/kitchen/board', async (c) => {
  const venues = await kitchenVenues();
  const requested = Number(c.req.query('venueId'));
  let selected = null;
  if (Number.isInteger(requested) && requested > 0) {
    selected = venues.find((venue) => venue.id === requested) || null;
    if (!selected) {
      return sendError(c, 404, 'Кухня на этом заведении не включена', 'KITCHEN_OFF');
    }
  } else if (venues.length === 1) {
    selected = venues[0];
  }

  const board = selected ? await loadBoard(selected.id) : null;
  return c.json({ venues, board });
});

async function stampTicketItemsReady(client, ticketId) {
  await client.query(
    `UPDATE kitchen_ticket_items
     SET ready_at = COALESCE(ready_at, now())
     WHERE ticket_id = $1`,
    [ticketId]
  );
}

apiKitchen.post('/kitchen/tickets/:id/ready', async (c) => {
  const ticketId = Number(c.req.param('id'));
  if (!Number.isInteger(ticketId)) {
    return sendError(c, 400, 'Некорректный заказ', 'BAD_TICKET');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE kitchen_tickets kt
       SET status = 'ready', ready_at = COALESCE(kt.ready_at, now())
       WHERE kt.id = $1
         AND kt.status IN ('new', 'ready')
         AND EXISTS (
           SELECT 1 FROM devices d
           WHERE d.venue_id = kt.venue_id
             AND d.is_active = true
             AND COALESCE(d.kitchen_enabled, false) = true
         )
       RETURNING id, status, ready_at, table_id, venue_id`,
      [ticketId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return sendError(c, 404, 'Заказ кухни не найден', 'NOT_FOUND');
    }
    // Старое приложение кухни отмечает весь тикет: позиции тоже становятся готовыми,
    // иначе зал с новой логикой подсветки их не увидит.
    await stampTicketItemsReady(client, ticketId);
    await client.query('COMMIT');
    return c.json({
      ticket: {
        id: rows[0].id,
        status: rows[0].status,
        readyAt: rows[0].ready_at ? new Date(rows[0].ready_at).toISOString() : null,
        tableId: rows[0].table_id,
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* уже откатили */
    }
    console.error('kitchen ticket ready', err);
    return sendError(c, 500, 'Не удалось отметить готовность', 'KITCHEN_READY_FAILED');
  } finally {
    client.release();
  }
});

apiKitchen.post('/kitchen/items/:id/ready', async (c) => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isInteger(itemId)) {
    return sendError(c, 400, 'Некорректная позиция', 'BAD_ITEM');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE kitchen_ticket_items kti
       SET ready_at = COALESCE(kti.ready_at, now())
       FROM kitchen_tickets kt
       WHERE kti.id = $1
         AND kt.id = kti.ticket_id
         AND kt.status IN ('new', 'ready')
         AND EXISTS (
           SELECT 1 FROM devices d
           WHERE d.venue_id = kt.venue_id
             AND d.is_active = true
             AND COALESCE(d.kitchen_enabled, false) = true
         )
         AND EXISTS (
           SELECT 1 FROM orders o
           JOIN order_guests og ON og.id = kt.guest_id
           WHERE o.id = kt.order_id AND o.status = 'open' AND og.status = 'open'
         )
       RETURNING kti.id, kti.ticket_id, kti.ready_at`,
      [itemId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return sendError(c, 404, 'Позиция кухни не найдена', 'NOT_FOUND');
    }
    const ticketId = rows[0].ticket_id;
    const { rows: pending } = await client.query(
      `SELECT COUNT(*)::int AS left_count
       FROM kitchen_ticket_items
       WHERE ticket_id = $1 AND ready_at IS NULL`,
      [ticketId]
    );
    const allReady = Number(pending[0].left_count) === 0;
    // $2 нельзя использовать и как varchar status, и в сравнении с text:
    // PostgreSQL отвечает «inconsistent types deduced for parameter».
    const { rows: ticketRows } = await client.query(
      allReady
        ? `UPDATE kitchen_tickets
           SET status = 'ready', ready_at = COALESCE(ready_at, now())
           WHERE id = $1
           RETURNING status, ready_at`
        : `UPDATE kitchen_tickets
           SET status = 'new'
           WHERE id = $1
           RETURNING status, ready_at`,
      [ticketId]
    );
    await client.query('COMMIT');
    return c.json({
      item: {
        id: rows[0].id,
        ready: true,
        ticketId,
        ticketStatus: ticketRows[0]?.status || (allReady ? 'ready' : 'new'),
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* уже откатили */
    }
    console.error('kitchen item ready', err);
    return sendError(c, 500, 'Не удалось отметить позицию', 'KITCHEN_ITEM_READY_FAILED');
  } finally {
    client.release();
  }
});

apiKitchen.get('/kitchen/ready', requireStaffToken, async (c) => {
  const venueId = Number(c.req.query('venueId'));
  if (!Number.isInteger(venueId) || venueId <= 0) {
    return sendError(c, 400, 'Не указано заведение', 'VENUE_REQUIRED');
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT kt.order_id
     FROM kitchen_ticket_items kti
     JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
     JOIN orders o ON o.id = kt.order_id AND o.status = 'open'
     JOIN order_guests og ON og.id = kt.guest_id AND og.status = 'open'
     WHERE kt.venue_id = $1
       AND kti.ready_at IS NOT NULL
       AND kti.acked_at IS NULL`,
    [venueId]
  );
  // tableIds оставлен пустым: старые терминалы больше не зажигают плитку стола.
  return c.json({ orderIds: rows.map((row) => row.order_id), tableIds: [] });
});

apiKitchen.post('/kitchen/orders/:orderId/ack', requireStaffToken, async (c) => {
  const orderId = Number(c.req.param('orderId'));
  if (!Number.isInteger(orderId)) {
    return sendError(c, 400, 'Некорректный заказ', 'BAD_ORDER');
  }
  const { rowCount } = await pool.query(
    `UPDATE kitchen_ticket_items kti
     SET acked_at = now()
     FROM kitchen_tickets kt
     WHERE kt.id = kti.ticket_id
       AND kt.order_id = $1
       AND kti.ready_at IS NOT NULL
       AND kti.acked_at IS NULL`,
    [orderId]
  );
  return c.json({ acked: rowCount || 0 });
});

apiKitchen.get('/kitchen/orders/:orderId', requireStaffToken, async (c) => {
  const orderId = Number(c.req.param('orderId'));
  if (!Number.isInteger(orderId)) {
    return sendError(c, 400, 'Некорректный заказ', 'BAD_ORDER');
  }
  const { rows } = await pool.query(
    `SELECT kti.order_item_id,
            SUM(kti.qty)::int AS sent_qty,
            SUM(CASE WHEN kti.ready_at IS NOT NULL THEN kti.qty ELSE 0 END)::int AS ready_qty
     FROM kitchen_ticket_items kti
     JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
     WHERE kt.order_id = $1 AND kt.status IN ('new', 'ready') AND kti.order_item_id IS NOT NULL
     GROUP BY kti.order_item_id`,
    [orderId]
  );
  const { rows: guests } = await pool.query(
    `SELECT DISTINCT oi.guest_id
     FROM kitchen_ticket_items kti
     JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
     JOIN order_items oi ON oi.id = kti.order_item_id
     WHERE kt.order_id = $1
       AND kt.status IN ('new', 'ready')
       AND kti.ready_at IS NOT NULL
       AND oi.guest_id IS NOT NULL`,
    [orderId]
  );
  return c.json({
    items: rows.map((row) => ({
      orderItemId: row.order_item_id,
      sentQty: Number(row.sent_qty),
      readyQty: Number(row.ready_qty) || 0,
    })),
    readyGuestIds: guests.map((row) => row.guest_id),
  });
});

apiKitchen.post('/orders/:orderId/guests/:guestId/kitchen', requireStaffToken, async (c) => {
  const orderId = Number(c.req.param('orderId'));
  const guestId = Number(c.req.param('guestId'));
  const staff = c.get('staff');
  const deviceToken = c.req.header('x-device-token') || '';
  if (!deviceToken) {
    return sendError(c, 401, 'Терминал не авторизован', 'DEVICE_REQUIRED');
  }
  const device = await findDeviceByToken(deviceToken);
  if (!device || !device.is_active) {
    return sendError(c, 401, 'Терминал не активен', 'DEVICE_INACTIVE');
  }
  if (!device.kitchen_enabled) {
    return sendError(c, 409, 'Сначала включите кухню на этом терминале', 'KITCHEN_OFF');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: guestRows } = await client.query(
      `SELECT og.id, og.label, og.precheck_printed_at, og.status AS guest_status,
              o.id AS order_id, o.venue_id, o.table_id, o.status AS order_status
       FROM order_guests og
       JOIN orders o ON o.id = og.order_id
       WHERE og.id = $1 AND og.order_id = $2
       FOR UPDATE OF og`,
      [guestId, orderId]
    );
    const guest = guestRows[0];
    if (!guest || guest.guest_status !== 'open' || guest.order_status !== 'open') {
      await client.query('ROLLBACK');
      return sendError(c, 409, 'Чек уже закрыт', 'GUEST_CLOSED');
    }
    if (device.venue_id !== guest.venue_id) {
      await client.query('ROLLBACK');
      return sendError(c, 403, 'Терминал назначен на другое заведение', 'VENUE_MISMATCH');
    }
    if (guest.precheck_printed_at) {
      await client.query('ROLLBACK');
      return sendError(c, 409, 'Пречек уже напечатан — на кухню отправляют до пречека', 'PRECHECK_LOCKED');
    }

    const { rows: shiftRows } = await client.query(
      "SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open'",
      [guest.venue_id]
    );
    if (!shiftRows[0]) {
      await client.query('ROLLBACK');
      return sendError(c, 409, 'Смена закрыта', 'SHIFT_REQUIRED');
    }

    const { rows: itemRows } = await client.query(
      `SELECT oi.id, oi.name, oi.qty, oi.serve_in,
              COALESCE(sent.sent_qty, 0)::int AS sent_qty
       FROM order_items oi
       LEFT JOIN (
         SELECT kti.order_item_id, SUM(kti.qty) AS sent_qty
         FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
         WHERE kt.order_id = $1 AND kt.status IN ('new', 'ready')
         GROUP BY kti.order_item_id
       ) sent ON sent.order_item_id = oi.id
       WHERE oi.order_id = $1 AND oi.guest_id = $2
       ORDER BY oi.id
       FOR UPDATE OF oi`,
      [orderId, guestId]
    );

    const fresh = itemRows.filter((item) => Number(item.qty) - Number(item.sent_qty) > 0);
    if (!fresh.length) {
      await client.query('ROLLBACK');
      return sendError(c, 409, 'Новых позиций для кухни нет — всё уже отправлено', 'NOTHING_TO_SEND');
    }

    const itemIds = fresh.map((item) => item.id);
    const { rows: modRows } = await client.query(
      `SELECT oim.order_item_id, oim.name, oim.qty, COALESCE(wi.unit, m.unit) AS unit
       FROM order_item_modifiers oim
       LEFT JOIN modifiers m ON m.id = oim.modifier_id
       LEFT JOIN warehouse_items wi ON wi.id = oim.warehouse_item_id
       WHERE oim.order_item_id = ANY($1::int[])
       ORDER BY oim.id`,
      [itemIds]
    );
    const modsByItem = new Map();
    for (const mod of modRows) {
      const list = modsByItem.get(mod.order_item_id) || [];
      list.push({
        name: mod.name,
        qty: Number(mod.qty) || 0,
        unit: mod.unit || null,
      });
      modsByItem.set(mod.order_item_id, list);
    }

    const { rows: ticketRows } = await client.query(
      `INSERT INTO kitchen_tickets
         (venue_id, shift_id, order_id, guest_id, table_id, status, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, 'new', $6, $7)
       RETURNING id`,
      [
        guest.venue_id,
        shiftRows[0].id,
        orderId,
        guestId,
        guest.table_id,
        staff.sub || null,
        staff.name || null,
      ]
    );
    const ticketId = ticketRows[0].id;

    for (const item of fresh) {
      const delta = Number(item.qty) - Number(item.sent_qty);
      await client.query(
        `INSERT INTO kitchen_ticket_items (ticket_id, order_item_id, name, qty, modifiers, serve_in)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [ticketId, item.id, item.name, delta, JSON.stringify(modsByItem.get(item.id) || []), item.serve_in || null]
      );
    }

    await client.query('COMMIT');

    const { rows: sentRows } = await pool.query(
      `SELECT kti.order_item_id, SUM(kti.qty)::int AS sent_qty
       FROM kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
       WHERE kt.order_id = $1 AND kt.status IN ('new', 'ready') AND kti.order_item_id IS NOT NULL
       GROUP BY kti.order_item_id`,
      [orderId]
    );

    return c.json({
      ticket: { id: ticketId, status: 'new', itemCount: fresh.length },
      items: sentRows.map((row) => ({
        orderItemId: row.order_item_id,
        sentQty: Number(row.sent_qty),
      })),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* уже откатили */
    }
    console.error('kitchen send', err);
    return sendError(c, 500, 'Не удалось отправить на кухню', 'KITCHEN_SEND_FAILED');
  } finally {
    client.release();
  }
});

export default apiKitchen;

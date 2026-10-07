import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireDeviceToken } from '../middleware/deviceAuth.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { fetchVenueMenu } from '../services/venueMenu.js';

const apiKiosk = new Hono();

const UNIT_LABELS = { g: 'г', ml: 'мл', pcs: 'шт' };

const ALLOWED_NEXT = {
  new: ['payment', 'cooking', 'ready', 'issued', 'cancelled'],
  payment: ['new', 'cooking', 'ready', 'issued', 'cancelled'],
  cooking: ['new', 'payment', 'ready', 'issued', 'cancelled'],
  ready: ['new', 'cooking', 'issued'],
  issued: [],
  cancelled: [],
};

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function sendError(c, err) {
  const status = err.status || 500;
  c.status(status);
  return c.json({ error: err.message || 'Ошибка', code: err.code || 'ERROR' });
}

async function fetchVenueFlags(venueId) {
  const { rows } = await pool.query(
    `SELECT id, name,
            COALESCE(kiosk_enabled, false) AS kiosk_enabled,
            COALESCE(kiosk_cashless_discount_percent, 12) AS kiosk_cashless_discount_percent,
            kiosk_qr_image_url
     FROM venues WHERE id = $1`,
    [venueId]
  );
  return rows[0] || null;
}

async function fetchOpenShift(venueId) {
  const { rows } = await pool.query(
    "SELECT id FROM shifts WHERE venue_id = $1 AND status = 'open'",
    [venueId]
  );
  return rows[0] || null;
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

async function fetchMenuItemAttachments(client, menuItemId) {
  const { rows } = await client.query(
    `SELECT mim.modifier_id, mim.is_default,
            m.name, m.group_id, mg.name AS group_name, mg.min_select, mg.max_select,
            COALESCE(mim.price_override, m.price) AS price,
            COALESCE(mim.qty_override, m.qty) AS qty,
            m.warehouse_item_id, wi.unit AS warehouse_unit
     FROM menu_item_modifiers mim
     JOIN modifiers m ON m.id = mim.modifier_id
     LEFT JOIN modifier_groups mg ON mg.id = m.group_id
     LEFT JOIN warehouse_items wi ON wi.id = m.warehouse_item_id
     WHERE mim.menu_item_id = $1`,
    [menuItemId]
  );
  return rows;
}

function assertValidModifierSelection(attachments, selectedModifierIds) {
  const attachmentByModifierId = new Map(attachments.map((a) => [a.modifier_id, a]));
  const hasInvalid = selectedModifierIds.some((id) => !attachmentByModifierId.has(id));
  if (hasInvalid) {
    throw httpError('Выбран модификатор, не относящийся к этой позиции', 400, 'INVALID_MODIFIER');
  }

  const countsByGroup = new Map();
  for (const modId of selectedModifierIds) {
    const groupId = attachmentByModifierId.get(modId).group_id;
    if (!groupId) continue;
    countsByGroup.set(groupId, (countsByGroup.get(groupId) || 0) + 1);
  }
  const groupsInvolved = new Map();
  const optionsPerGroup = new Map();
  for (const a of attachments) {
    if (!a.group_id) continue;
    optionsPerGroup.set(a.group_id, (optionsPerGroup.get(a.group_id) || 0) + 1);
    if (!groupsInvolved.has(a.group_id)) {
      groupsInvolved.set(a.group_id, { name: a.group_name, min: a.min_select, max: a.max_select });
    }
  }
  for (const [groupId, info] of groupsInvolved) {
    const count = countsByGroup.get(groupId) || 0;
    const optionCount = optionsPerGroup.get(groupId) || 0;
    const effectiveMax = info.max == null ? null : Math.min(info.max, optionCount);
    const effectiveMin = Math.min(Math.max(info.min, 0), optionCount);
    if (effectiveMax != null && count > effectiveMax) {
      throw httpError(
        `В группе «${info.name}» можно выбрать не больше ${effectiveMax}`,
        400,
        'MODIFIER_GROUP_LIMIT'
      );
    }
    if (effectiveMin > 0 && count < effectiveMin) {
      throw httpError(
        `В группе «${info.name}» нужно выбрать хотя бы ${effectiveMin}`,
        400,
        'MODIFIER_GROUP_LIMIT'
      );
    }
  }

  return selectedModifierIds.map((id) => attachmentByModifierId.get(id));
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function closeLinkedKioskOrder(client, ticket) {
  if (!ticket?.order_id) return;
  if (ticket.guest_id) {
    await client.query("UPDATE order_guests SET status = 'paid' WHERE id = $1 AND status = 'open'", [
      ticket.guest_id,
    ]);
  }
  await client.query("UPDATE orders SET status = 'paid', closed_at = COALESCE(closed_at, now()) WHERE id = $1 AND status = 'open'", [
    ticket.order_id,
  ]);
}

function serializeTicket(ticket, items) {
  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    guestName: ticket.guest_name || null,
    comment: ticket.comment || null,
    paymentMethod: ticket.payment_method || null,
    paymentStatus: ticket.payment_status || 'unpaid',
    discountPercent: Number(ticket.discount_percent || 0),
    subtotal: Number(ticket.subtotal || ticket.total),
    total: Number(ticket.total),
    orderId: ticket.order_id || null,
    guestId: ticket.guest_id || null,
    createdAt: ticket.created_at,
    cookingAt: ticket.cooking_at,
    readyAt: ticket.ready_at,
    issuedAt: ticket.issued_at,
    cancelledAt: ticket.cancelled_at,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      qty: Number(item.qty),
      price: Number(item.price),
      modifiers: (item.modifiers || []).map((m) => ({
        name: m.name,
        price: Number(m.price),
        qty: Number(m.qty) || 0,
        unit: m.unit || null,
        unitLabel: m.unit ? UNIT_LABELS[m.unit] || m.unit : null,
      })),
    })),
  };
}

async function fetchTicketItems(ticketId) {
  const { rows: itemRows } = await pool.query(
    'SELECT id, name, qty, price FROM kiosk_ticket_items WHERE ticket_id = $1 ORDER BY id',
    [ticketId]
  );
  if (!itemRows.length) return [];
  const { rows: modRows } = await pool.query(
    `SELECT ticket_item_id, name, price, qty, unit
     FROM kiosk_ticket_item_modifiers
     WHERE ticket_item_id = ANY($1::int[])
     ORDER BY id`,
    [itemRows.map((r) => r.id)]
  );
  const modsByItem = new Map();
  for (const row of modRows) {
    if (!modsByItem.has(row.ticket_item_id)) modsByItem.set(row.ticket_item_id, []);
    modsByItem.get(row.ticket_item_id).push(row);
  }
  return itemRows.map((item) => ({ ...item, modifiers: modsByItem.get(item.id) || [] }));
}

async function fetchTicketDetail(ticketId) {
  const { rows } = await pool.query('SELECT * FROM kiosk_tickets WHERE id = $1', [ticketId]);
  if (!rows[0]) return null;
  const items = await fetchTicketItems(ticketId);
  return serializeTicket(rows[0], items);
}

async function requireReadyKioskDevice(c) {
  const device = c.get('device');
  if (!device.is_active) {
    throw httpError('Устройство деактивировано', 403, 'DEVICE_INACTIVE');
  }
  if (!device.venue_id) {
    throw httpError('Устройство не назначено на заведение', 403, 'DEVICE_NO_VENUE');
  }
  if ((device.kind || 'staff') !== 'kiosk') {
    throw httpError('Это устройство не киоск — смени тип в бэкофисе', 403, 'NOT_KIOSK');
  }
  const venue = await fetchVenueFlags(device.venue_id);
  if (!venue) {
    throw httpError('Заведение не найдено', 404, 'VENUE_NOT_FOUND');
  }
  if (!venue.kiosk_enabled) {
    throw httpError('Киоск на этом заведении выключен', 403, 'KIOSK_DISABLED');
  }
  const shift = await fetchOpenShift(device.venue_id);
  if (!shift) {
    throw httpError('Смена закрыта — киоск недоступен', 409, 'SHIFT_CLOSED');
  }
  return { device, venue, shift };
}

apiKiosk.get('/bootstrap', requireDeviceToken, async (c) => {
  const device = c.get('device');
  await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);

  let venue = null;
  if (device.venue_id) {
    venue = await fetchVenueFlags(device.venue_id);
  }
  const shift = venue ? await fetchOpenShift(venue.id) : null;
  const kioskEnabled = Boolean(venue?.kiosk_enabled);
  const kind = device.kind || 'staff';

  return c.json({
    active: device.is_active,
    kind,
    venue: venue
      ? {
          id: venue.id,
          name: venue.name,
          kioskEnabled,
          cashlessDiscountPercent: Number(venue.kiosk_cashless_discount_percent || 12),
          qrImageUrl: venue.kiosk_qr_image_url || null,
        }
      : null,
    shiftOpen: Boolean(shift),
    ready: Boolean(device.is_active && venue && kioskEnabled && shift && kind === 'kiosk'),
  });
});

apiKiosk.get('/mine', requireDeviceToken, async (c) => {
  try {
    const device = c.get('device');
    if (!device.venue_id) {
      return c.json({ tickets: [] });
    }
    const { rows: tickets } = await pool.query(
      `SELECT * FROM kiosk_tickets
       WHERE device_id = $1 AND venue_id = $2
         AND created_at > now() - interval '16 hours'
       ORDER BY created_at DESC
       LIMIT 30`,
      [device.id, device.venue_id]
    );
    const details = [];
    for (const ticket of tickets) {
      // eslint-disable-next-line no-await-in-loop
      const items = await fetchTicketItems(ticket.id);
      details.push(serializeTicket(ticket, items));
    }
    return c.json({ tickets: details });
  } catch (err) {
    return sendError(c, err);
  }
});

apiKiosk.get('/menu', requireDeviceToken, async (c) => {
  try {
    const { venue } = await requireReadyKioskDevice(c);
    const menu = await fetchVenueMenu(venue.id);
    return c.json(menu);
  } catch (err) {
    return sendError(c, err);
  }
});

apiKiosk.post('/tickets', requireDeviceToken, async (c) => {
  const client = await pool.connect();
  try {
    const { device, venue, shift } = await requireReadyKioskDevice(c);
    const body = await c.req.json().catch(() => null);
    const rawItems = body && Array.isArray(body.items) ? body.items : [];
    const guestName =
      body && typeof body.guestName === 'string' ? body.guestName.trim().slice(0, 80) : '';
    const comment = body && typeof body.comment === 'string' ? body.comment.trim().slice(0, 400) : '';
    const paymentMethod = body && typeof body.paymentMethod === 'string' ? body.paymentMethod : '';
    if (!['cash', 'card', 'qr'].includes(paymentMethod)) {
      throw httpError('Выбери способ оплаты', 400, 'PAYMENT_REQUIRED');
    }

    if (!rawItems.length) {
      throw httpError('Корзина пуста', 400, 'EMPTY_CART');
    }

    await client.query('BEGIN');
    await client.query('SELECT id FROM shifts WHERE id = $1 FOR UPDATE', [shift.id]);

    const { rows: numRows } = await client.query(
      'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM kiosk_tickets WHERE venue_id = $1 AND shift_id = $2',
      [venue.id, shift.id]
    );
    const number = Number(numRows[0].next);

    let total = 0;
    const prepared = [];

    for (const raw of rawItems) {
      const menuItemId = Number(raw.menuItemId || raw.menu_item_id);
      const qty = Math.max(1, Math.min(99, Number(raw.qty) || 1));
      const selectedIds = Array.isArray(raw.modifierIds || raw.modifier_ids)
        ? [...new Set((raw.modifierIds || raw.modifier_ids).map(Number).filter((n) => Number.isFinite(n)))]
        : null;
      if (!menuItemId) {
        throw httpError('Не указана позиция меню', 400, 'INVALID_ITEM');
      }

      // eslint-disable-next-line no-await-in-loop
      const { rows: itemRows } = await client.query(
        'SELECT id, name, price, is_active FROM menu_items WHERE id = $1',
        [menuItemId]
      );
      const menuItem = itemRows[0];
      if (!menuItem || !menuItem.is_active) {
        throw httpError('Позиция меню недоступна', 400, 'ITEM_UNAVAILABLE');
      }

      // eslint-disable-next-line no-await-in-loop
      const attachments = await fetchMenuItemAttachments(client, menuItemId);
      const chosenIds =
        selectedIds != null
          ? selectedIds
          : attachments.filter((a) => a.is_default).map((a) => a.modifier_id);
      const selected = assertValidModifierSelection(attachments, chosenIds);
      const unitPrice = Number(menuItem.price) + selected.reduce((sum, a) => sum + Number(a.price), 0);
      const lineTotal = unitPrice * qty;
      total += lineTotal;
      prepared.push({ menuItem, qty, selected, unitPrice });
    }

    const discountPercent =
      paymentMethod === 'qr'
        ? Math.max(0, Math.min(100, Number(venue.kiosk_cashless_discount_percent || 12)))
        : 0;
    const discount = roundMoney((total * discountPercent) / 100);
    const payable = roundMoney(total - discount);
    const paymentStatus = 'unpaid';
    const initialStatus = 'payment';

    const { rows: orderRows } = await client.query(
      "INSERT INTO orders (table_id, venue_id, status, opened_by, source) VALUES (NULL, $1, 'open', NULL, 'kiosk') RETURNING id",
      [venue.id]
    );
    const orderId = orderRows[0].id;
    const { rows: guestRows } = await client.query(
      'INSERT INTO order_guests (order_id, label, discount_percent) VALUES ($1, $2, $3) RETURNING id',
      [orderId, `Киоск №${number}`, discountPercent]
    );
    const guestId = guestRows[0].id;

    const { rows: ticketRows } = await client.query(
      `INSERT INTO kiosk_tickets
         (venue_id, device_id, shift_id, number, status, guest_name, comment, total,
          payment_method, payment_status, discount_percent, subtotal, order_id, guest_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        venue.id,
        device.id,
        shift.id,
        number,
        initialStatus,
        guestName || null,
        comment || null,
        payable,
        paymentMethod,
        paymentStatus,
        discountPercent,
        total,
        orderId,
        guestId,
      ]
    );
    const ticket = ticketRows[0];

    for (const line of prepared) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: inserted } = await client.query(
        `INSERT INTO kiosk_ticket_items (ticket_id, menu_item_id, name, qty, price)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [ticket.id, line.menuItem.id, line.menuItem.name, line.qty, line.unitPrice]
      );
      const ticketItemId = inserted[0].id;
      for (const a of line.selected) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO kiosk_ticket_item_modifiers
             (ticket_item_id, modifier_id, name, price, warehouse_item_id, qty, unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ticketItemId,
            a.modifier_id,
            a.name,
            a.price,
            a.warehouse_item_id,
            a.qty,
            a.warehouse_unit || null,
          ]
        );
        if (a.warehouse_item_id && Number(a.qty) > 0) {
          // eslint-disable-next-line no-await-in-loop
          await applyStockDelta(client, venue.id, a.warehouse_item_id, -Number(a.qty) * line.qty);
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const { rows: orderItemRows } = await client.query(
        `INSERT INTO order_items (order_id, guest_id, menu_item_id, name, price, qty)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [orderId, guestId, line.menuItem.id, line.menuItem.name, line.unitPrice, line.qty]
      );
      const orderItemId = orderItemRows[0].id;
      for (const a of line.selected) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO order_item_modifiers (order_item_id, modifier_id, name, price, warehouse_item_id, qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderItemId, a.modifier_id, a.name, a.price, a.warehouse_item_id, a.qty]
        );
      }
    }

    await client.query('COMMIT');
    const detail = await fetchTicketDetail(ticket.id);
    return c.json({ ticket: detail });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return sendError(c, err);
  } finally {
    client.release();
  }
});

apiKiosk.get('/tickets/:id', requireDeviceToken, async (c) => {
  try {
    const device = c.get('device');
    const ticketId = Number(c.req.param('id'));
    const { rows } = await pool.query('SELECT * FROM kiosk_tickets WHERE id = $1', [ticketId]);
    const ticket = rows[0];
    if (!ticket) {
      throw httpError('Заявка не найдена', 404, 'NOT_FOUND');
    }
    if (ticket.device_id !== device.id && (device.kind || 'staff') === 'kiosk') {
      throw httpError('Заявка другого киоска', 403, 'FORBIDDEN');
    }
    if (ticket.venue_id !== device.venue_id) {
      throw httpError('Заявка другого заведения', 403, 'FORBIDDEN');
    }
    const items = await fetchTicketItems(ticket.id);
    return c.json({ ticket: serializeTicket(ticket, items) });
  } catch (err) {
    return sendError(c, err);
  }
});

apiKiosk.get('/tickets', requireStaffToken, async (c) => {
  const venueId = Number(c.req.query('venueId'));
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }
  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    return c.json({ tickets: [], shiftOpen: false });
  }
  const { rows: tickets } = await pool.query(
    `SELECT * FROM kiosk_tickets
     WHERE venue_id = $1 AND shift_id = $2
     ORDER BY
       CASE status
         WHEN 'payment' THEN 0
         WHEN 'new' THEN 1
         WHEN 'cooking' THEN 2
         WHEN 'ready' THEN 3
         WHEN 'issued' THEN 4
         ELSE 5
       END,
       created_at ASC`,
    [venueId, shift.id]
  );
  const details = [];
  for (const ticket of tickets) {
    // eslint-disable-next-line no-await-in-loop
    const items = await fetchTicketItems(ticket.id);
    details.push(serializeTicket(ticket, items));
  }
  return c.json({ tickets: details, shiftOpen: true });
});

apiKiosk.post('/tickets/:id/status', requireStaffToken, async (c) => {
  const client = await pool.connect();
  try {
    const ticketId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => null);
    const nextStatus = body && typeof body.status === 'string' ? body.status : '';
    if (!ALLOWED_NEXT[nextStatus] && nextStatus !== 'cancelled') {
      throw httpError('Неизвестный статус', 400, 'INVALID_STATUS');
    }

    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM kiosk_tickets WHERE id = $1 FOR UPDATE', [
      ticketId,
    ]);
    const ticket = rows[0];
    if (!ticket) {
      throw httpError('Заявка не найдена', 404, 'NOT_FOUND');
    }
    const allowed = ALLOWED_NEXT[ticket.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw httpError(`Нельзя сменить статус «${ticket.status}» на «${nextStatus}»`, 409, 'BAD_TRANSITION');
    }

    if (
      ['cooking', 'ready', 'issued'].includes(nextStatus) &&
      ticket.payment_status !== 'paid'
    ) {
      throw httpError('Сначала примите оплату', 409, 'NEED_PAYMENT');
    }

    const extraStamp =
      nextStatus === 'issued'
        ? ', ready_at = COALESCE(ready_at, now()), issued_at = now()'
        : nextStatus === 'cooking'
          ? ', cooking_at = now()'
          : nextStatus === 'ready'
            ? ', ready_at = now()'
            : nextStatus === 'cancelled'
              ? ', cancelled_at = now()'
              : '';

    await client.query(`UPDATE kiosk_tickets SET status = $2${extraStamp} WHERE id = $1`, [
      ticketId,
      nextStatus,
    ]);

    if (nextStatus === 'issued') {
      await closeLinkedKioskOrder(client, ticket);
    }

    if (nextStatus === 'cancelled') {
      let guestAlreadyCancelled = false;
      if (ticket.guest_id) {
        const { rows: guestRows } = await client.query(
          'SELECT status FROM order_guests WHERE id = $1',
          [ticket.guest_id]
        );
        guestAlreadyCancelled = guestRows[0]?.status === 'cancelled';
      }
      // Если чек гостя уже отменили через кассу, склад вернули там.
      // Повторно с киоска не возвращаем, иначе остаток удвоится.
      const { rows: itemRows } = guestAlreadyCancelled
        ? { rows: [] }
        : await client.query('SELECT id, qty FROM kiosk_ticket_items WHERE ticket_id = $1', [ticketId]);
      for (const item of itemRows) {
        // eslint-disable-next-line no-await-in-loop
        const { rows: mods } = await client.query(
          'SELECT warehouse_item_id, qty FROM kiosk_ticket_item_modifiers WHERE ticket_item_id = $1',
          [item.id]
        );
        for (const m of mods) {
          if (m.warehouse_item_id && Number(m.qty) > 0) {
            // eslint-disable-next-line no-await-in-loop
            await applyStockDelta(
              client,
              ticket.venue_id,
              m.warehouse_item_id,
              Number(m.qty) * Number(item.qty)
            );
          }
        }
      }
      if (ticket.guest_id && ticket.payment_status !== 'paid') {
        await client.query("UPDATE order_guests SET status = 'cancelled' WHERE id = $1 AND status = 'open'", [
          ticket.guest_id,
        ]);
        if (ticket.order_id) {
          await client.query(
            "UPDATE orders SET status = 'cancelled', closed_at = now() WHERE id = $1 AND status = 'open'",
            [ticket.order_id]
          );
        }
      }
    }

    await client.query('COMMIT');
    const detail = await fetchTicketDetail(ticketId);
    return c.json({ ticket: detail });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return sendError(c, err);
  } finally {
    client.release();
  }
});

apiKiosk.post('/tickets/:id/close', requireStaffToken, async (c) => {
  const ticketId = Number(c.req.param('id'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM kiosk_tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    const ticket = rows[0];
    if (!ticket) throw httpError('Заявка не найдена', 404, 'NOT_FOUND');
    if (ticket.status === 'cancelled' || ticket.status === 'issued') {
      throw httpError('Заказ уже закрыт', 409, 'ALREADY_CLOSED');
    }
    if (ticket.payment_status !== 'paid') {
      throw httpError('Сначала проведите оплату', 409, 'NEED_PAYMENT');
    }
    await client.query(
      `UPDATE kiosk_tickets
       SET status = 'issued',
           ready_at = COALESCE(ready_at, now()),
           issued_at = now()
       WHERE id = $1`,
      [ticketId]
    );
    await closeLinkedKioskOrder(client, ticket);
    await client.query('COMMIT');
    return c.json({ ticket: await fetchTicketDetail(ticketId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return sendError(c, err);
  } finally {
    client.release();
  }
});

export default apiKiosk;

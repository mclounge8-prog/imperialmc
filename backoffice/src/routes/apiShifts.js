import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { enqueueCashFiscalJob, enqueueShiftFiscalJob } from '../services/fiscalQueue.js';

const apiShifts = new Hono();
apiShifts.use('*', requireStaffToken);

const PAYMENT_METHODS = ['cash', 'card', 'other'];

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function fetchCashMovementTotals(shiftId) {
  const { rows } = await pool.query(
    `SELECT type, COALESCE(SUM(amount), 0) AS amount
     FROM cash_movements
     WHERE shift_id = $1
     GROUP BY type`,
    [shiftId]
  );
  const totals = { deposit: 0, withdrawal: 0 };
  for (const row of rows) {
    if (row.type === 'deposit' || row.type === 'withdrawal') {
      totals[row.type] = Number(row.amount);
    }
  }
  return totals;
}

// Живая сводка по чекам смены + учёт наличности в кассе.
async function fetchShiftStats(shift) {
  const shiftId = shift.id;
  const { rows: totalsRows } = await pool.query(
    `SELECT COUNT(*) AS receipts_count, COALESCE(SUM(total), 0) AS revenue_total
     FROM receipts WHERE shift_id = $1 AND status = 'paid'`,
    [shiftId]
  );
  const receiptsCount = Number(totalsRows[0].receipts_count);
  const revenueTotal = Number(totalsRows[0].revenue_total);

  const { rows: paymentRows } = await pool.query(
    `SELECT rp.method, COALESCE(SUM(rp.amount), 0) AS amount
     FROM receipt_payments rp
     JOIN receipts r ON r.id = rp.receipt_id
     WHERE r.shift_id = $1 AND r.status = 'paid'
     GROUP BY rp.method`,
    [shiftId]
  );
  const paymentBreakdown = { cash: 0, card: 0, other: 0 };
  for (const row of paymentRows) {
    if (PAYMENT_METHODS.includes(row.method)) {
      paymentBreakdown[row.method] = Number(row.amount);
    }
  }

  const movements = await fetchCashMovementTotals(shiftId);
  const openingCash = Number(shift.opening_cash || 0);
  const expectedCash = roundMoney(
    openingCash + paymentBreakdown.cash + movements.deposit - movements.withdrawal
  );

  const cash = {
    openingCash,
    cashSales: paymentBreakdown.cash,
    deposits: movements.deposit,
    withdrawals: movements.withdrawal,
    expectedCash,
    // Фактический пересчёт — только после закрытия (или null, пока открыта).
    countedCash: shift.closing_cash != null ? Number(shift.closing_cash) : null,
    difference:
      shift.closing_cash != null
        ? roundMoney(Number(shift.closing_cash) - Number(shift.closing_cash_expected ?? expectedCash))
        : null,
  };

  return {
    receiptsCount,
    guestsCount: receiptsCount,
    revenueTotal,
    avgCheck: receiptsCount > 0 ? revenueTotal / receiptsCount : 0,
    paymentBreakdown,
    cash,
  };
}

function serializeShift(shift, stats) {
  return {
    id: shift.id,
    venueId: shift.venue_id,
    status: shift.status,
    openedAt: shift.opened_at,
    openedByName: shift.opened_by_name,
    closedAt: shift.closed_at,
    closedByName: shift.closed_by_name,
    openingCash: Number(shift.opening_cash || 0),
    closingCash: shift.closing_cash != null ? Number(shift.closing_cash) : null,
    ...stats,
  };
}

async function fetchOpenShift(venueId) {
  const { rows } = await pool.query("SELECT * FROM shifts WHERE venue_id = $1 AND status = 'open'", [
    venueId,
  ]);
  return rows[0] || null;
}

/** Открытые заказы с суммой > 0 — мешают закрытию смены. */
async function fetchOpenPositiveOrders(venueId) {
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
     ORDER BY o.opened_at`,
    [venueId]
  );
  return rows
    .filter((r) => Number(r.total) > 0.009)
    .map((r) => ({
      id: r.id,
      tableId: r.table_id,
      tableName: r.table_name || 'Быстрый заказ',
      total: Number(r.total),
    }));
}

function parseMoney(value, { allowZero = true } = {}) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (!allowZero && n <= 0) return null;
  return roundMoney(n);
}

apiShifts.get('/current', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    return c.json({ shift: null });
  }

  const stats = await fetchShiftStats(shift);
  return c.json({ shift: serializeShift(shift, stats) });
});

apiShifts.post('/open', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;
  const openingCash = parseMoney(body?.opening_cash ?? body?.openingCash ?? 0);
  if (openingCash == null) {
    c.status(400);
    return c.json({ error: 'Некорректный остаток наличных на открытии' });
  }

  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const existing = await fetchOpenShift(venueId);
  if (existing) {
    c.status(409);
    return c.json({ error: 'Смена уже открыта' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO shifts (venue_id, status, opened_by, opened_by_name, opening_cash)
       VALUES ($1, 'open', $2, $3, $4)
       RETURNING *`,
      [venueId, staff.sub, staff.name, openingCash]
    );
    const shift = rows[0];

    await enqueueShiftFiscalJob(client, {
      venueId,
      shiftId: shift.id,
      type: 'open_shift',
      operatorName: staff.name,
    });

    // Остаток на открытии = внесение в денежный ящик ККТ (учётный чек cashIn).
    if (openingCash > 0) {
      await enqueueCashFiscalJob(client, {
        venueId,
        shiftId: shift.id,
        type: 'cash_in',
        amount: openingCash,
        operatorName: staff.name,
      });
    }

    await client.query('COMMIT');
    const stats = await fetchShiftStats(shift);
    return c.json({ shift: serializeShift(shift, stats) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

apiShifts.post('/close', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;
  const countedCash = parseMoney(body?.closing_cash ?? body?.closingCash ?? body?.counted_cash);
  const forcePin = body?.force_pin != null ? String(body.force_pin) : body?.forcePin != null ? String(body.forcePin) : null;

  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }
  if (countedCash == null) {
    c.status(400);
    return c.json({ error: 'Укажите фактический остаток наличных в кассе' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    c.status(409);
    return c.json({ error: 'Открытой смены нет' });
  }

  const openPositive = await fetchOpenPositiveOrders(venueId);
  if (openPositive.length > 0) {
    const preview = openPositive
      .slice(0, 5)
      .map((o) => `${o.tableName} (${Math.round(o.total)} ₽)`)
      .join(', ');
    const more = openPositive.length > 5 ? ` и ещё ${openPositive.length - 5}` : '';
    c.status(409);
    return c.json({
      error: `Нельзя закрыть смену: есть открытые чеки на сумму > 0 — ${preview}${more}. Сначала закройте или оплатите их.`,
      code: 'OPEN_ORDERS_EXIST',
      orders: openPositive,
    });
  }

  const stats = await fetchShiftStats(shift);
  const expectedCash = stats.cash.expectedCash;
  const mismatch = Math.abs(countedCash - expectedCash) > 0.009;
  const FORCE_CLOSE_PIN = '3467';

  // Пока наличность не сходится — закрытие запрещено, кроме спец. PIN 3467.
  // Открытие при расхождении счётчика ФР не блокируем.
  if (mismatch) {
    if (forcePin == null || forcePin === '') {
      c.status(409);
      return c.json({
        error:
          `Наличность не сходится: по учёту ${expectedCash.toFixed(0)} ₽, факт ${countedCash.toFixed(0)} ₽. ` +
          `Пересчитайте кассу или введите PIN для принудительного закрытия.`,
        code: 'CASH_MISMATCH',
        expectedCash,
        countedCash,
      });
    }
    if (forcePin !== FORCE_CLOSE_PIN) {
      c.status(403);
      return c.json({ error: 'Неверный PIN для принудительного закрытия', code: 'FORCE_PIN_INVALID' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE shifts
       SET status = 'closed', closed_by = $1, closed_by_name = $2, closed_at = now(),
           receipts_count = $3, revenue_total = $4,
           closing_cash = $5, closing_cash_expected = $6
       WHERE id = $7
       RETURNING *`,
      [
        staff.sub,
        staff.name,
        stats.receiptsCount,
        stats.revenueTotal,
        countedCash,
        expectedCash,
        shift.id,
      ]
    );

    await enqueueShiftFiscalJob(client, {
      venueId,
      shiftId: shift.id,
      type: 'close_shift',
      operatorName: staff.name,
    });

    await client.query('COMMIT');
    const closedStats = await fetchShiftStats(rows[0]);
    return c.json({
      shift: serializeShift(rows[0], closedStats),
      forcedClose: Boolean(mismatch && forcePin === FORCE_CLOSE_PIN),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Внесение / инкассация наличных в открытой смене (+ учётный чек на АТОЛ).
apiShifts.post('/cash-movements', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;
  const type = body?.type === 'withdrawal' || body?.type === 'deposit' ? body.type : null;
  const amount = parseMoney(body?.amount, { allowZero: false });
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 200) : null;

  if (!venueId || !type || amount == null) {
    c.status(400);
    return c.json({ error: 'Нужны venue_id, type (deposit|withdrawal) и amount > 0' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    c.status(409);
    return c.json({ error: 'Открытой смены нет — операция с наличными недоступна' });
  }

  if (type === 'withdrawal') {
    const stats = await fetchShiftStats(shift);
    if (amount > stats.cash.expectedCash + 0.001) {
      c.status(400);
      return c.json({
        error: `Нельзя изъять ${amount} ₽: в кассе ожидается ${stats.cash.expectedCash} ₽`,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO cash_movements (venue_id, shift_id, type, amount, comment, staff_id, staff_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [venueId, shift.id, type, amount, comment, staff.sub, staff.name]
    );

    await enqueueCashFiscalJob(client, {
      venueId,
      shiftId: shift.id,
      type: type === 'deposit' ? 'cash_in' : 'cash_out',
      amount,
      operatorName: staff.name,
    });

    await client.query('COMMIT');

    const refreshed = await fetchOpenShift(venueId);
    const stats = await fetchShiftStats(refreshed);
    return c.json({
      movement: {
        id: rows[0].id,
        type: rows[0].type,
        amount: Number(rows[0].amount),
        comment: rows[0].comment,
        staffName: rows[0].staff_name,
        createdAt: rows[0].created_at,
      },
      shift: serializeShift(refreshed, stats),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

apiShifts.get('/cash-movements', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    return c.json({ shift: null, movements: [] });
  }

  const { rows } = await pool.query(
    `SELECT id, type, amount, comment, staff_name, created_at
     FROM cash_movements
     WHERE shift_id = $1
     ORDER BY id DESC
     LIMIT 50`,
    [shift.id]
  );

  return c.json({
    shift: { id: shift.id },
    movements: rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      comment: r.comment,
      staffName: r.staff_name,
      createdAt: r.created_at,
    })),
  });
});

apiShifts.get('/receipts', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    return c.json({ shift: null, receipts: [] });
  }

  const { rows } = await pool.query(
    `SELECT r.id, r.table_name, r.guest_label, r.staff_name, r.status, r.total, r.closed_at,
            (SELECT string_agg(DISTINCT rp.method, ',') FROM receipt_payments rp WHERE rp.receipt_id = r.id) AS payment_methods
     FROM receipts r
     WHERE r.shift_id = $1
     ORDER BY r.closed_at DESC`,
    [shift.id]
  );

  const receipts = rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    guestLabel: r.guest_label,
    staffName: r.staff_name,
    status: r.status,
    total: Number(r.total),
    closedAt: r.closed_at,
    paymentMethods: r.payment_methods ? r.payment_methods.split(',') : [],
  }));

  return c.json({ shift: { id: shift.id }, receipts });
});

export default apiShifts;

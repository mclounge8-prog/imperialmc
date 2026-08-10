import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';

const apiShifts = new Hono();
apiShifts.use('*', requireStaffToken);

const PAYMENT_METHODS = ['cash', 'card', 'other'];

// Живая сводка по чекам смены — работает и для открытой смены (на текущий
// момент), и для уже закрытой (тогда это просто её финальные цифры).
async function fetchShiftStats(shiftId) {
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

  return {
    receiptsCount,
    // Каждый receipt — это уже расчёт одного гостя (см. схему БД), поэтому
    // кол-во чеков и кол-во обслуженных гостей за смену совпадают по построению.
    guestsCount: receiptsCount,
    revenueTotal,
    avgCheck: receiptsCount > 0 ? revenueTotal / receiptsCount : 0,
    paymentBreakdown,
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
    ...stats,
  };
}

async function fetchOpenShift(venueId) {
  const { rows } = await pool.query("SELECT * FROM shifts WHERE venue_id = $1 AND status = 'open'", [
    venueId,
  ]);
  return rows[0] || null;
}

// Текущая (открытая) смена заведения с живой сводкой — если смены нет,
// shift: null, терминал в этом случае предлагает открыть новую.
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

  const stats = await fetchShiftStats(shift.id);
  return c.json({ shift: serializeShift(shift, stats) });
});

apiShifts.post('/open', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;

  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const existing = await fetchOpenShift(venueId);
  if (existing) {
    c.status(409);
    return c.json({ error: 'Смена уже открыта' });
  }

  const { rows } = await pool.query(
    `INSERT INTO shifts (venue_id, status, opened_by, opened_by_name)
     VALUES ($1, 'open', $2, $3)
     RETURNING *`,
    [venueId, staff.sub, staff.name]
  );

  const stats = await fetchShiftStats(rows[0].id);
  return c.json({ shift: serializeShift(rows[0], stats) });
});

apiShifts.post('/close', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body && body.venue_id ? Number(body.venue_id) : null;

  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) {
    c.status(409);
    return c.json({ error: 'Открытой смены нет' });
  }

  const stats = await fetchShiftStats(shift.id);

  const { rows } = await pool.query(
    `UPDATE shifts
     SET status = 'closed', closed_by = $1, closed_by_name = $2, closed_at = now(),
         receipts_count = $3, revenue_total = $4
     WHERE id = $5
     RETURNING *`,
    [staff.sub, staff.name, stats.receiptsCount, stats.revenueTotal, shift.id]
  );

  return c.json({ shift: serializeShift(rows[0], stats) });
});

// Чеки текущей открытой смены заведения — если смена не открыта, отдаём
// пустой список с явным флагом, а не 404: экран должен спокойно показать
// «смена не открыта», а не выглядеть как ошибка сети.
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

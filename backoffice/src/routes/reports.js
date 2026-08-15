import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { renderReceiptsSection, renderReceiptDetail, renderItemStatsSection } from '../views/reportsView.js';

const reports = new Hono();
reports.use('*', requireAuthApi);

export const PAGE_SIZE = 50;

// По умолчанию — последние 7 дней, а не вся история разом: при ~1000 чеках в
// сутки "показать всё" и медленно, и бесполезно листать. Явный диапазон дат
// в фильтре всегда можно расширить.
export function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export async function fetchReceiptsPage({ venueId, dateFrom, dateTo, page }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (venueId) {
    conditions.push(`r.venue_id = $${idx}`);
    params.push(venueId);
    idx += 1;
  }
  if (dateFrom) {
    conditions.push(`r.closed_at >= $${idx}`);
    params.push(`${dateFrom} 00:00:00`);
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`r.closed_at <= $${idx}`);
    params.push(`${dateTo} 23:59:59`);
    idx += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM receipts r ${where}`,
    params
  );
  const totalCount = Number(countRows[0].count);

  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * PAGE_SIZE;

  const { rows } = await pool.query(
    `SELECT r.id, r.venue_id, v.name AS venue_name, r.table_name, r.guest_label, r.staff_name,
            r.status, r.total, r.closed_at, r.opened_at,
            r.cancel_comment, r.precheck_was_printed,
            (SELECT string_agg(DISTINCT rp.method, ',') FROM receipt_payments rp WHERE rp.receipt_id = r.id) AS payment_methods
     FROM receipts r
     LEFT JOIN venues v ON v.id = r.venue_id
     ${where}
     ORDER BY r.closed_at DESC
     LIMIT ${PAGE_SIZE} OFFSET $${idx}`,
    [...params, offset]
  );

  return { rows, totalCount, page: safePage };
}

reports.get('/receipts', async (c) => {
  const venueId = c.req.query('venueId') || null;
  let dateFrom = c.req.query('from') || null;
  let dateTo = c.req.query('to') || null;
  const page = Number(c.req.query('page')) || 1;

  if (!dateFrom && !dateTo) {
    const defaults = defaultDateRange();
    dateFrom = defaults.from;
    dateTo = defaults.to;
  }

  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const { rows: receipts, totalCount } = await fetchReceiptsPage({ venueId, dateFrom, dateTo, page });

  return c.html(
    renderReceiptsSection(venues, venueId, dateFrom, dateTo, receipts, {
      page,
      totalCount,
      pageSize: PAGE_SIZE,
    })
  );
});

// Агрегат по позициям меню — только оплаченные чеки (без отмен/возвратов),
// без возможности провалиться в конкретный чек, это просто сводная цифра
async function fetchItemStats({ venueId, dateFrom, dateTo }) {
  const conditions = [`r.status = 'paid'`];
  const params = [];
  let idx = 1;

  if (venueId) {
    conditions.push(`r.venue_id = $${idx}`);
    params.push(venueId);
    idx += 1;
  }
  if (dateFrom) {
    conditions.push(`r.closed_at >= $${idx}`);
    params.push(`${dateFrom} 00:00:00`);
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`r.closed_at <= $${idx}`);
    params.push(`${dateTo} 23:59:59`);
    idx += 1;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT ri.name, ri.category_name, SUM(ri.qty) AS total_qty, SUM(ri.line_total) AS total_revenue
     FROM receipt_items ri
     JOIN receipts r ON r.id = ri.receipt_id
     ${where}
     GROUP BY ri.name, ri.category_name
     ORDER BY total_revenue DESC`,
    params
  );
  return rows;
}

reports.get('/items', async (c) => {
  const venueId = c.req.query('venueId') || null;
  let dateFrom = c.req.query('from') || null;
  let dateTo = c.req.query('to') || null;

  if (!dateFrom && !dateTo) {
    const defaults = defaultDateRange();
    dateFrom = defaults.from;
    dateTo = defaults.to;
  }

  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const items = await fetchItemStats({ venueId, dateFrom, dateTo });

  return c.html(renderItemStatsSection(venues, venueId, dateFrom, dateTo, items));
});

reports.get('/receipts/:id', async (c) => {
  const id = c.req.param('id');
  const { rows: receiptRows } = await pool.query(
    `SELECT r.*, v.name AS venue_name FROM receipts r LEFT JOIN venues v ON v.id = r.venue_id WHERE r.id = $1`,
    [id]
  );
  const receipt = receiptRows[0];
  if (!receipt) {
    c.status(404);
    return c.text('Чек не найден');
  }

  const { rows: items } = await pool.query(
    'SELECT * FROM receipt_items WHERE receipt_id = $1 ORDER BY id',
    [id]
  );
  const { rows: payments } = await pool.query(
    'SELECT * FROM receipt_payments WHERE receipt_id = $1 ORDER BY id',
    [id]
  );

  return c.html(renderReceiptDetail(receipt, items, payments));
});

export default reports;

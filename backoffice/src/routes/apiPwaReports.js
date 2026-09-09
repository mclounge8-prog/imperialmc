import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  defaultDateRange,
  fetchItemStats,
  fetchReceiptsPage,
  fetchReceiptsSummary,
  PAGE_SIZE,
} from './reports.js';
import {
  formatVenueDateTime,
  venueMondayISO,
  venueMonthStartISO,
  venueShiftDaysISO,
  venueTodayISO,
} from '../utils/timezone.js';

/**
 * JSON-отчёты для мобильной PWA: блюда и чеки.
 * Границы суток — Asia/Yekaterinburg (как /reports в бэкофисе).
 */
const apiPwaReports = new Hono();
apiPwaReports.use('*', requireAuthApi);

const PRESETS = new Set(['today', 'yesterday', 'last7', 'week', 'month']);

function parseDateParam(value) {
  const raw = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function resolvePeriod(c) {
  const fromQ = parseDateParam(c.req.query('from'));
  const toQ = parseDateParam(c.req.query('to'));
  const presetRaw = String(c.req.query('preset') || '').trim();
  const preset = PRESETS.has(presetRaw) ? presetRaw : null;

  if (fromQ || toQ) {
    const from = fromQ || toQ;
    const to = toQ || fromQ;
    return { from, to, preset: null };
  }

  const today = venueTodayISO();
  if (preset === 'today') return { from: today, to: today, preset };
  if (preset === 'yesterday') {
    const y = venueShiftDaysISO(today, -1);
    return { from: y, to: y, preset };
  }
  if (preset === 'week') return { from: venueMondayISO(today), to: today, preset };
  if (preset === 'month') return { from: venueMonthStartISO(today), to: today, preset };

  const defaults = defaultDateRange();
  return { from: defaults.from, to: defaults.to, preset: preset || 'last7' };
}

function paymentLabel(methods) {
  if (!methods) return '';
  return String(methods)
    .split(',')
    .map((m) => {
      if (m === 'cash') return 'Нал';
      if (m === 'card') return 'Карта';
      if (m === 'other') return 'Другое';
      return m;
    })
    .filter(Boolean)
    .join('+');
}

apiPwaReports.get('/reports/items', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const { from, to, preset } = resolvePeriod(c);
  const rows = await fetchItemStats({ venueId, dateFrom: from, dateTo: to });

  const items = rows.map((row) => ({
    name: row.name,
    categoryName: row.category_name || null,
    qty: Number(row.total_qty),
    revenue: Number(row.total_revenue),
  }));

  const summary = {
    itemCount: items.length,
    totalQty: items.reduce((sum, i) => sum + i.qty, 0),
    totalRevenue: items.reduce((sum, i) => sum + i.revenue, 0),
  };

  return c.json({
    from,
    to,
    preset,
    venueId: venueId || null,
    summary,
    items,
  });
});

apiPwaReports.get('/reports/receipts', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const { from, to, preset } = resolvePeriod(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);

  const [{ rows, totalCount }, summary] = await Promise.all([
    fetchReceiptsPage({ venueId, dateFrom: from, dateTo: to, page }),
    fetchReceiptsSummary({ venueId, dateFrom: from, dateTo: to }),
  ]);

  return c.json({
    from,
    to,
    preset,
    venueId: venueId || null,
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    summary,
    receipts: rows.map((r) => ({
      id: r.id,
      venueId: r.venue_id,
      venueName: r.venue_name,
      tableName: r.table_name,
      guestLabel: r.guest_label,
      staffName: r.staff_name,
      status: r.status,
      total: Number(r.total),
      discount: Number(r.discount || 0),
      discountPercent: Number(r.discount_percent || 0),
      closedAt: r.closed_at,
      closedAtLabel: formatVenueDateTime(r.closed_at),
      paymentMethods: r.payment_methods || '',
      paymentLabel: paymentLabel(r.payment_methods),
      cancelComment: r.cancel_comment || null,
    })),
  });
});

apiPwaReports.get('/reports/receipts/:id', async (c) => {
  const id = c.req.param('id');
  const { rows: receiptRows } = await pool.query(
    `SELECT r.*, v.name AS venue_name
     FROM receipts r
     LEFT JOIN venues v ON v.id = r.venue_id
     WHERE r.id = $1`,
    [id]
  );
  const receipt = receiptRows[0];
  if (!receipt) return c.json({ error: 'Чек не найден' }, 404);

  const [{ rows: items }, { rows: payments }] = await Promise.all([
    pool.query('SELECT * FROM receipt_items WHERE receipt_id = $1 ORDER BY id', [id]),
    pool.query('SELECT * FROM receipt_payments WHERE receipt_id = $1 ORDER BY id', [id]),
  ]);

  return c.json({
    receipt: {
      id: receipt.id,
      venueId: receipt.venue_id,
      venueName: receipt.venue_name,
      tableName: receipt.table_name,
      guestLabel: receipt.guest_label,
      staffName: receipt.staff_name,
      status: receipt.status,
      subtotal: Number(receipt.subtotal || 0),
      discount: Number(receipt.discount || 0),
      discountPercent: Number(receipt.discount_percent || 0),
      total: Number(receipt.total || 0),
      openedAt: receipt.opened_at,
      closedAt: receipt.closed_at,
      openedAtLabel: formatVenueDateTime(receipt.opened_at),
      closedAtLabel: formatVenueDateTime(receipt.closed_at),
      cancelComment: receipt.cancel_comment || null,
      precheckWasPrinted: Boolean(receipt.precheck_was_printed),
    },
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      categoryName: i.category_name || null,
      qty: Number(i.qty),
      price: Number(i.price),
      lineTotal: Number(i.line_total),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
    })),
  });
});

export default apiPwaReports;

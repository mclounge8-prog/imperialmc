import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderReceiptsSection,
  renderReceiptDetail,
  renderItemStatsSection,
  renderCashSection,
} from '../views/reportsView.js';

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

function parseReportFilters(c) {
  let dateFrom = c.req.query('from') || null;
  let dateTo = c.req.query('to') || null;
  const venueId = c.req.query('venueId') || null;
  if (!dateFrom && !dateTo) {
    const defaults = defaultDateRange();
    dateFrom = defaults.from;
    dateTo = defaults.to;
  }
  return { venueId, dateFrom, dateTo };
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(';')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(';'));
  }
  // BOM — чтобы Excel на Windows открыл UTF-8 кириллицу
  return `\uFEFF${lines.join('\n')}\n`;
}

function sendCsv(c, filename, headers, rows) {
  const body = toCsv(headers, rows);
  return c.body(body, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}

function receiptWhere({ venueId, dateFrom, dateTo }, alias = 'r') {
  const conditions = [];
  const params = [];
  let idx = 1;
  if (venueId) {
    conditions.push(`${alias}.venue_id = $${idx}`);
    params.push(venueId);
    idx += 1;
  }
  if (dateFrom) {
    conditions.push(`${alias}.closed_at >= $${idx}`);
    params.push(`${dateFrom} 00:00:00`);
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`${alias}.closed_at <= $${idx}`);
    params.push(`${dateTo} 23:59:59`);
    idx += 1;
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    nextIdx: idx,
  };
}

export async function fetchReceiptsPage({ venueId, dateFrom, dateTo, page }) {
  const { where, params, nextIdx } = receiptWhere({ venueId, dateFrom, dateTo });
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
            r.cancel_comment, r.precheck_was_printed, r.discount, r.discount_percent,
            (SELECT string_agg(DISTINCT rp.method, ',') FROM receipt_payments rp WHERE rp.receipt_id = r.id) AS payment_methods
     FROM receipts r
     LEFT JOIN venues v ON v.id = r.venue_id
     ${where}
     ORDER BY r.closed_at DESC
     LIMIT ${PAGE_SIZE} OFFSET $${nextIdx}`,
    [...params, offset]
  );

  return { rows, totalCount, page: safePage };
}

export async function fetchReceiptsSummary({ venueId, dateFrom, dateTo }) {
  const { where, params } = receiptWhere({ venueId, dateFrom, dateTo });
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE r.status = 'paid')::int AS paid_count,
       COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled_count,
       COALESCE(SUM(r.total) FILTER (WHERE r.status = 'paid'), 0) AS paid_total,
       COALESCE(SUM(r.discount) FILTER (WHERE r.status = 'paid'), 0) AS discount_total
     FROM receipts r
     ${where}`,
    params
  );
  const row = rows[0] || {};
  return {
    paidCount: Number(row.paid_count || 0),
    cancelledCount: Number(row.cancelled_count || 0),
    paidTotal: Number(row.paid_total || 0),
    discountTotal: Number(row.discount_total || 0),
  };
}

async function fetchReceiptsForExport({ venueId, dateFrom, dateTo }) {
  const { where, params } = receiptWhere({ venueId, dateFrom, dateTo });
  const { rows } = await pool.query(
    `SELECT r.id, r.closed_at, v.name AS venue_name, r.table_name, r.guest_label, r.staff_name,
            r.status, r.subtotal, r.discount, r.discount_percent, r.total,
            r.cancel_comment, r.precheck_was_printed,
            COALESCE((
              SELECT string_agg(rp.method || ':' || rp.amount::text, '|')
              FROM receipt_payments rp WHERE rp.receipt_id = r.id
            ), '') AS payments
     FROM receipts r
     LEFT JOIN venues v ON v.id = r.venue_id
     ${where}
     ORDER BY r.closed_at DESC`,
    params
  );
  return rows;
}

// Агрегат по позициям меню — только оплаченные чеки (без отмен/возвратов)
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

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Смены за период с разбивкой кассы — основа вкладки «Касса» и CSV. */
async function fetchCashShifts({ venueId, dateFrom, dateTo }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (venueId) {
    conditions.push(`s.venue_id = $${idx}`);
    params.push(venueId);
    idx += 1;
  }
  // Период по дате открытия; закрытые смены «за день» обычно открыты в тот же день.
  if (dateFrom) {
    conditions.push(`s.opened_at >= $${idx}`);
    params.push(`${dateFrom} 00:00:00`);
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`s.opened_at <= $${idx}`);
    params.push(`${dateTo} 23:59:59`);
    idx += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT s.id, s.venue_id, v.name AS venue_name, s.status,
            s.opened_at, s.closed_at, s.opened_by_name, s.closed_by_name,
            s.opening_cash, s.closing_cash, s.closing_cash_expected,
            COALESCE(pay.cash_sales, 0) AS cash_sales,
            COALESCE(pay.card_sales, 0) AS card_sales,
            COALESCE(pay.other_sales, 0) AS other_sales,
            COALESCE(rec.revenue_total, 0) AS revenue_total,
            COALESCE(rec.receipts_count, 0) AS receipts_count,
            COALESCE(mov.deposits, 0) AS deposits,
            COALESCE(mov.withdrawals, 0) AS withdrawals
     FROM shifts s
     JOIN venues v ON v.id = s.venue_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE r.status = 'paid')::int AS receipts_count,
         COALESCE(SUM(r.total) FILTER (WHERE r.status = 'paid'), 0) AS revenue_total
       FROM receipts r
       WHERE r.shift_id = s.id
     ) rec ON true
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(rp.amount) FILTER (WHERE rp.method = 'cash'), 0) AS cash_sales,
         COALESCE(SUM(rp.amount) FILTER (WHERE rp.method = 'card'), 0) AS card_sales,
         COALESCE(SUM(rp.amount) FILTER (WHERE rp.method = 'other'), 0) AS other_sales
       FROM receipt_payments rp
       JOIN receipts r ON r.id = rp.receipt_id
       WHERE r.shift_id = s.id AND r.status = 'paid'
     ) pay ON true
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) AS deposits,
         COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) AS withdrawals
       FROM cash_movements
       WHERE shift_id = s.id
     ) mov ON true
     ${where}
     ORDER BY s.opened_at DESC`,
    params
  );

  return rows.map((row) => {
    const openingCash = Number(row.opening_cash || 0);
    const cashSales = Number(row.cash_sales || 0);
    const deposits = Number(row.deposits || 0);
    const withdrawals = Number(row.withdrawals || 0);
    const expectedCash = roundMoney(openingCash + cashSales + deposits - withdrawals);
    const countedCash = row.closing_cash != null ? Number(row.closing_cash) : null;
    const expectedAtClose =
      row.closing_cash_expected != null ? Number(row.closing_cash_expected) : expectedCash;
    const difference =
      countedCash != null ? roundMoney(countedCash - expectedAtClose) : null;
    const day = new Date(row.opened_at).toISOString().slice(0, 10);

    return {
      id: row.id,
      venueId: row.venue_id,
      venueName: row.venue_name,
      status: row.status,
      day,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openedByName: row.opened_by_name,
      closedByName: row.closed_by_name,
      openingCash,
      cashSales,
      cardSales: Number(row.card_sales || 0),
      otherSales: Number(row.other_sales || 0),
      deposits,
      withdrawals,
      expectedCash,
      countedCash,
      difference,
      receiptsCount: Number(row.receipts_count || 0),
      revenueTotal: Number(row.revenue_total || 0),
    };
  });
}

/** Сводка по дням (агрегат смен) — удобно смотреть «кассу за день». */
function aggregateCashByDay(shifts) {
  const map = new Map();
  for (const s of shifts) {
    const key = `${s.day}|${s.venueId}`;
    if (!map.has(key)) {
      map.set(key, {
        day: s.day,
        venueId: s.venueId,
        venueName: s.venueName,
        shiftsCount: 0,
        receiptsCount: 0,
        revenueTotal: 0,
        cashSales: 0,
        cardSales: 0,
        otherSales: 0,
        deposits: 0,
        withdrawals: 0,
        openingCash: 0,
        expectedCash: 0,
        countedCash: 0,
        countedShifts: 0,
        difference: 0,
      });
    }
    const row = map.get(key);
    row.shiftsCount += 1;
    row.receiptsCount += s.receiptsCount;
    row.revenueTotal = roundMoney(row.revenueTotal + s.revenueTotal);
    row.cashSales = roundMoney(row.cashSales + s.cashSales);
    row.cardSales = roundMoney(row.cardSales + s.cardSales);
    row.otherSales = roundMoney(row.otherSales + s.otherSales);
    row.deposits = roundMoney(row.deposits + s.deposits);
    row.withdrawals = roundMoney(row.withdrawals + s.withdrawals);
    row.openingCash = roundMoney(row.openingCash + s.openingCash);
    row.expectedCash = roundMoney(row.expectedCash + s.expectedCash);
    if (s.countedCash != null) {
      row.countedCash = roundMoney(row.countedCash + s.countedCash);
      row.countedShifts += 1;
      row.difference = roundMoney(row.difference + (s.difference || 0));
    }
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

reports.get('/receipts', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const page = Number(c.req.query('page')) || 1;

  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const [{ rows: receipts, totalCount }, summary] = await Promise.all([
    fetchReceiptsPage({ venueId, dateFrom, dateTo, page }),
    fetchReceiptsSummary({ venueId, dateFrom, dateTo }),
  ]);

  return c.html(
    renderReceiptsSection(venues, venueId, dateFrom, dateTo, receipts, {
      page,
      totalCount,
      pageSize: PAGE_SIZE,
      summary,
    })
  );
});

reports.get('/items', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const items = await fetchItemStats({ venueId, dateFrom, dateTo });
  return c.html(renderItemStatsSection(venues, venueId, dateFrom, dateTo, items));
});

reports.get('/cash', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const shifts = await fetchCashShifts({ venueId, dateFrom, dateTo });
  const byDay = aggregateCashByDay(shifts);
  return c.html(renderCashSection(venues, venueId, dateFrom, dateTo, byDay, shifts));
});

reports.get('/export/receipts', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const rows = await fetchReceiptsForExport({ venueId, dateFrom, dateTo });
  const METHOD = { cash: 'Наличные', card: 'Карта', other: 'Другое' };
  const STATUS = { paid: 'Оплачен', cancelled: 'Отменён' };
  const csvRows = rows.map((r) => {
    const payments = String(r.payments || '')
      .split('|')
      .filter(Boolean)
      .map((p) => {
        const [m, a] = p.split(':');
        return `${METHOD[m] || m}:${a}`;
      })
      .join(', ');
    return [
      r.id,
      r.closed_at ? new Date(r.closed_at).toLocaleString('ru-RU') : '',
      r.venue_name || '',
      r.table_name || 'Быстрый заказ',
      r.guest_label || '',
      r.staff_name || '',
      STATUS[r.status] || r.status,
      Number(r.subtotal).toFixed(2),
      Number(r.discount || 0).toFixed(2),
      r.discount_percent != null ? Number(r.discount_percent) : '',
      Number(r.total).toFixed(2),
      payments,
      r.precheck_was_printed ? 'да' : '',
      r.cancel_comment || '',
    ];
  });
  const name = `receipts_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;
  return sendCsv(
    c,
    name,
    [
      'ID',
      'Закрыт',
      'Заведение',
      'Стол',
      'Гость',
      'Сотрудник',
      'Статус',
      'Сумма без скидки',
      'Скидка',
      'Скидка %',
      'Итого',
      'Оплата',
      'Был пречек',
      'Комментарий отмены',
    ],
    csvRows
  );
});

reports.get('/export/items', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const items = await fetchItemStats({ venueId, dateFrom, dateTo });
  const csvRows = items.map((i) => [
    i.name,
    i.category_name || '',
    Number(i.total_qty),
    Number(i.total_revenue).toFixed(2),
  ]);
  return sendCsv(
    c,
    `items_${dateFrom || 'all'}_${dateTo || 'all'}.csv`,
    ['Позиция', 'Категория', 'Кол-во', 'Выручка'],
    csvRows
  );
});

reports.get('/export/cash', async (c) => {
  const { venueId, dateFrom, dateTo } = parseReportFilters(c);
  const mode = c.req.query('mode') === 'shifts' ? 'shifts' : 'days';
  const shifts = await fetchCashShifts({ venueId, dateFrom, dateTo });

  if (mode === 'shifts') {
    const csvRows = shifts.map((s) => [
      s.day,
      s.id,
      s.venueName,
      s.status === 'open' ? 'Открыта' : 'Закрыта',
      s.openedAt ? new Date(s.openedAt).toLocaleString('ru-RU') : '',
      s.closedAt ? new Date(s.closedAt).toLocaleString('ru-RU') : '',
      s.openedByName || '',
      s.closedByName || '',
      s.openingCash.toFixed(2),
      s.cashSales.toFixed(2),
      s.cardSales.toFixed(2),
      s.otherSales.toFixed(2),
      s.deposits.toFixed(2),
      s.withdrawals.toFixed(2),
      s.expectedCash.toFixed(2),
      s.countedCash != null ? s.countedCash.toFixed(2) : '',
      s.difference != null ? s.difference.toFixed(2) : '',
      s.receiptsCount,
      s.revenueTotal.toFixed(2),
    ]);
    return sendCsv(
      c,
      `cash_shifts_${dateFrom || 'all'}_${dateTo || 'all'}.csv`,
      [
        'День',
        'Смена ID',
        'Заведение',
        'Статус',
        'Открыта',
        'Закрыта',
        'Открыл',
        'Закрыл',
        'Начало кассы',
        'Наличные продажи',
        'Карта',
        'Другое',
        'Внесения',
        'Инкассации',
        'Ожидалось',
        'Факт',
        'Разница',
        'Чеков',
        'Выручка',
      ],
      csvRows
    );
  }

  const byDay = aggregateCashByDay(shifts);
  const csvRows = byDay.map((d) => [
    d.day,
    d.venueName,
    d.shiftsCount,
    d.openingCash.toFixed(2),
    d.cashSales.toFixed(2),
    d.cardSales.toFixed(2),
    d.otherSales.toFixed(2),
    d.deposits.toFixed(2),
    d.withdrawals.toFixed(2),
    d.expectedCash.toFixed(2),
    d.countedShifts > 0 ? d.countedCash.toFixed(2) : '',
    d.countedShifts > 0 ? d.difference.toFixed(2) : '',
    d.receiptsCount,
    d.revenueTotal.toFixed(2),
  ]);
  return sendCsv(
    c,
    `cash_days_${dateFrom || 'all'}_${dateTo || 'all'}.csv`,
    [
      'День',
      'Заведение',
      'Смен',
      'Начало кассы',
      'Наличные продажи',
      'Карта',
      'Другое',
      'Внесения',
      'Инкассации',
      'Ожидалось',
      'Факт',
      'Разница',
      'Чеков',
      'Выручка',
    ],
    csvRows
  );
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

import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderDashboardSection,
  renderRevenueWidgetBody,
  renderTopItemsWidgetBody,
  renderTopItemsDonutBody,
} from '../views/statsView.js';
import {
  formatVenueDayShort,
  formatVenueMonthShort,
  venueDayRange,
  venueHour,
  venueMondayISO,
  venueMonthStartISO,
  venueQuarterStartISO,
  venueShiftDaysISO,
  venueTodayISO,
} from '../utils/timezone.js';
import { fetchCashOnHand } from '../services/cashOnHand.js';

const stats = new Hono();
stats.use('*', requireAuthApi);

// ============================================================
// Границы бакетов — Asia/Yekaterinburg (как отчёты).
// Раньше здесь был UTC: почасовые графики сдвигались на −5 ч.
// ============================================================

function buildDayBuckets(count, todayISO) {
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = venueShiftDaysISO(todayISO, -i);
    const { start, end } = venueDayRange(day);
    buckets.push({ start, end, label: formatVenueDayShort(day), day });
  }
  return buckets;
}

function buildWeekBuckets(count, todayISO) {
  const thisWeekStartISO = venueMondayISO(todayISO);
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const weekStartISO = venueShiftDaysISO(thisWeekStartISO, -i * 7);
    const weekEndISO = venueShiftDaysISO(weekStartISO, 6);
    const { start } = venueDayRange(weekStartISO);
    const { end } = venueDayRange(weekEndISO);
    buckets.push({
      start,
      end,
      label: `${formatVenueDayShort(weekStartISO)}–${formatVenueDayShort(weekEndISO)}`,
    });
  }
  return buckets;
}

function buildMonthBuckets(count, todayISO) {
  const months = [];
  let cursor = venueMonthStartISO(todayISO);
  for (let i = 0; i < count; i += 1) {
    months.unshift(cursor);
    cursor = venueMonthStartISO(venueShiftDaysISO(cursor, -1));
  }
  const nextAfterCurrent = venueMonthStartISO(venueShiftDaysISO(venueMonthStartISO(todayISO), 32));
  const buckets = [];
  for (let i = 0; i < months.length; i += 1) {
    const startISO = months[i];
    const endISO = i + 1 < months.length ? months[i + 1] : nextAfterCurrent;
    const { start } = venueDayRange(startISO);
    const { start: end } = venueDayRange(endISO);
    buckets.push({ start, end, label: formatVenueMonthShort(startISO) });
  }
  return buckets;
}

const TREND_BUCKET_COUNT = { day: 14, week: 8, month: 6 };
const TREND_BUILDERS = { day: buildDayBuckets, week: buildWeekBuckets, month: buildMonthBuckets };

function normalizePeriod(period) {
  return TREND_BUILDERS[period] ? period : 'day';
}

function buildTrendBuckets(period, todayISO) {
  const safePeriod = normalizePeriod(period);
  return TREND_BUILDERS[safePeriod](TREND_BUCKET_COUNT[safePeriod], todayISO);
}

function currentPeriodRange(period, now = new Date()) {
  const todayISO = venueTodayISO(now);
  const safePeriod = normalizePeriod(period);
  if (safePeriod === 'week') {
    const { start } = venueDayRange(venueMondayISO(todayISO));
    return { start, end: now };
  }
  if (safePeriod === 'month') {
    const { start } = venueDayRange(venueMonthStartISO(todayISO));
    return { start, end: now };
  }
  const { start } = venueDayRange(todayISO);
  return { start, end: now };
}

async function fetchPaidReceiptsInRange(start, end, venueId) {
  const conditions = [`status = 'paid'`, `closed_at >= $1`, `closed_at < $2`];
  const params = [start.toISOString(), end.toISOString()];
  if (venueId) {
    conditions.push(`venue_id = $3`);
    params.push(venueId);
  }
  const { rows } = await pool.query(
    `SELECT closed_at, total FROM receipts WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows;
}

async function fetchTrend(period, venueId) {
  const todayISO = venueTodayISO();
  const buckets = buildTrendBuckets(period, todayISO);
  const rows = await fetchPaidReceiptsInRange(buckets[0].start, buckets[buckets.length - 1].end, venueId);

  return buckets.map((b) => {
    let revenue = 0;
    let count = 0;
    for (const r of rows) {
      const closedAt = new Date(r.closed_at);
      if (closedAt >= b.start && closedAt < b.end) {
        revenue += Number(r.total);
        count += 1;
      }
    }
    return { label: b.label, revenue, count };
  });
}

async function fetchTopItems(period, venueId, limit = 5) {
  const { start, end } = currentPeriodRange(period);
  const conditions = [`r.status = 'paid'`, `r.closed_at >= $1`, `r.closed_at < $2`];
  const params = [start.toISOString(), end.toISOString()];
  if (venueId) {
    conditions.push(`r.venue_id = $3`);
    params.push(venueId);
  }
  const { rows } = await pool.query(
    `SELECT ri.name, SUM(ri.qty) AS qty, SUM(ri.line_total) AS revenue
     FROM receipt_items ri
     JOIN receipts r ON r.id = ri.receipt_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY ri.name
     ORDER BY revenue DESC
     LIMIT ${limit}`,
    params
  );
  return rows;
}

async function fetchTodayStats(venueId) {
  const now = new Date();
  const todayISO = venueTodayISO(now);
  const yesterdayISO = venueShiftDaysISO(todayISO, -1);
  const { start: todayStart, end: tomorrowStart } = venueDayRange(todayISO);
  const { start: yesterdayStart } = venueDayRange(yesterdayISO);

  const [todayRows, yesterdayRows] = await Promise.all([
    fetchPaidReceiptsInRange(todayStart, tomorrowStart, venueId),
    fetchPaidReceiptsInRange(yesterdayStart, todayStart, venueId),
  ]);

  const receiptCount = todayRows.length;
  const revenue = todayRows.reduce((sum, r) => sum + Number(r.total), 0);
  const yesterdayRevenue = yesterdayRows.reduce((sum, r) => sum + Number(r.total), 0);

  return {
    revenue,
    receiptCount,
    guestCount: receiptCount,
    avgCheck: receiptCount > 0 ? revenue / receiptCount : 0,
    yesterdayRevenue,
  };
}

/** Итоги: сегодня / неделя / месяц / квартал — для подвала виджета «Выручка». */
async function fetchPeriodTotals(venueId) {
  const now = new Date();
  const todayISO = venueTodayISO(now);
  const { start: todayStart } = venueDayRange(todayISO);
  const { start: weekStart } = venueDayRange(venueMondayISO(todayISO));
  const { start: monthStart } = venueDayRange(venueMonthStartISO(todayISO));
  const { start: quarterStart } = venueDayRange(venueQuarterStartISO(todayISO));

  const rows = await fetchPaidReceiptsInRange(quarterStart, now, venueId);

  let day = 0;
  let week = 0;
  let month = 0;
  let quarter = 0;
  for (const r of rows) {
    const closedAt = new Date(r.closed_at);
    const amount = Number(r.total);
    quarter += amount;
    if (closedAt >= monthStart) month += amount;
    if (closedAt >= weekStart) week += amount;
    if (closedAt >= todayStart) day += amount;
  }

  return { day, week, month, quarter };
}

async function fetchHourlyComparison(venueId) {
  const now = new Date();
  const todayISO = venueTodayISO(now);
  const yesterdayISO = venueShiftDaysISO(todayISO, -1);
  const { start: todayStart, end: tomorrowStart } = venueDayRange(todayISO);
  const { start: yesterdayStart } = venueDayRange(yesterdayISO);
  const rows = await fetchPaidReceiptsInRange(yesterdayStart, tomorrowStart, venueId);

  const todayHours = new Array(24).fill(0);
  const yesterdayHours = new Array(24).fill(0);
  const currentHour = venueHour(now);

  for (const r of rows) {
    const closedAt = new Date(r.closed_at);
    const hour = venueHour(closedAt);
    const amount = Number(r.total);
    if (closedAt >= todayStart) {
      todayHours[hour] += amount;
    } else {
      yesterdayHours[hour] += amount;
    }
  }

  const todayTotalSoFar = todayHours.slice(0, currentHour + 1).reduce((s, v) => s + v, 0);
  const yesterdayTotalSameWindow = yesterdayHours.slice(0, currentHour + 1).reduce((s, v) => s + v, 0);

  return { todayHours, yesterdayHours, currentHour, todayTotalSoFar, yesterdayTotalSameWindow };
}

async function buildDashboardData(venueId) {
  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');

  const [today, hourly, revenueTrend, topItems, periodTotals, cashOnHand] = await Promise.all([
    fetchTodayStats(venueId),
    fetchHourlyComparison(venueId),
    fetchTrend('week', venueId),
    fetchTopItems('day', venueId, 5),
    fetchPeriodTotals(venueId),
    fetchCashOnHand(venueId),
  ]);

  return { venues, venueId, today, hourly, revenueTrend, topItems, periodTotals, cashOnHand };
}

export async function renderDashboardFragment(venueId) {
  const data = await buildDashboardData(venueId);
  return renderDashboardSection(data);
}

stats.get('/', async (c) => {
  const venueId = c.req.query('venueId') || null;
  return c.html(await renderDashboardFragment(venueId));
});

stats.get('/revenue', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const [trend, periodTotals] = await Promise.all([
    fetchTrend(period, venueId),
    fetchPeriodTotals(venueId),
  ]);
  return c.html(renderRevenueWidgetBody(trend, periodTotals, period));
});

stats.get('/top-items', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const items = await fetchTopItems(period, venueId, 5);
  return c.html(renderTopItemsWidgetBody(items));
});

stats.get('/top-items-donut', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const items = await fetchTopItems(period, venueId, 5);
  return c.html(renderTopItemsDonutBody(items));
});

export default stats;

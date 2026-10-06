import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderDashboardSection,
  renderRevenueCard,
  renderHourlyWidget,
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
  venueIsoWeekday,
} from '../utils/timezone.js';
import { fetchCashOnHand } from '../services/cashOnHand.js';
import {
  forecastConfig,
  resolveHourlyModel,
  resolveSeriesModel,
  runHourlyForecast,
  runSeriesForecast,
} from '../services/revenueForecast.js';
import { readForecastModels, writeForecastModels } from '../utils/preferences.js';

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

  const currentHour = venueHour(now);
  const yesterdaySameWindow = yesterdayRows.reduce((sum, row) => {
    if (venueHour(new Date(row.closed_at)) <= currentHour) return sum + Number(row.total);
    return sum;
  }, 0);

  return {
    revenue,
    receiptCount,
    guestCount: receiptCount,
    avgCheck: receiptCount > 0 ? revenue / receiptCount : 0,
    yesterdayRevenue,
    yesterdaySameWindow,
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

async function fetchHourlyContext(venueId, lookbackWeeks = forecastConfig.weekdayLookback) {
  const now = new Date();
  const todayISO = venueTodayISO(now);
  const yesterdayISO = venueShiftDaysISO(todayISO, -1);
  const weekday = venueIsoWeekday(todayISO);
  const baselineDays = [];
  for (let week = 1; week <= lookbackWeeks; week += 1) {
    baselineDays.push(venueShiftDaysISO(todayISO, -7 * week));
  }
  const oldestISO = baselineDays[baselineDays.length - 1] || yesterdayISO;
  const startISO = oldestISO < yesterdayISO ? oldestISO : yesterdayISO;
  const { start } = venueDayRange(startISO);
  const { end: tomorrowStart } = venueDayRange(todayISO);
  const rows = await fetchPaidReceiptsInRange(start, tomorrowStart, venueId);

  const buckets = new Map();
  const touch = (day) => {
    if (!buckets.has(day)) buckets.set(day, new Array(24).fill(0));
    return buckets.get(day);
  };
  touch(todayISO);
  touch(yesterdayISO);
  for (const day of baselineDays) touch(day);

  for (const row of rows) {
    const closedAt = new Date(row.closed_at);
    const day = venueTodayISO(closedAt);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket[venueHour(closedAt)] += Number(row.total);
  }

  const todayHours = buckets.get(todayISO);
  const yesterdayHours = buckets.get(yesterdayISO);
  const currentHour = venueHour(now);
  const todayTotalSoFar = todayHours.slice(0, currentHour + 1).reduce((total, value) => total + value, 0);
  const yesterdayTotalSameWindow = yesterdayHours.slice(0, currentHour + 1).reduce((total, value) => total + value, 0);
  const sameWeekday = baselineDays.map((day) => ({
    day,
    hours: buckets.get(day),
  }));

  return {
    todayHours,
    yesterdayHours,
    currentHour,
    todayTotalSoFar,
    yesterdayTotalSameWindow,
    sameWeekday,
    weekday,
  };
}

function forecastChoice(c) {
  const saved = readForecastModels(c);
  const hourlyFromQuery = c.req.query('hourlyModel');
  const seriesFromQuery = c.req.query('seriesModel');
  const hourlyModel = resolveHourlyModel(hourlyFromQuery || saved.hourlyModel);
  const seriesModel = resolveSeriesModel(seriesFromQuery || saved.seriesModel);
  if (hourlyFromQuery || seriesFromQuery) {
    writeForecastModels(c, {
      hourlyModel: hourlyFromQuery ? hourlyModel : saved.hourlyModel,
      seriesModel: seriesFromQuery ? seriesModel : saved.seriesModel,
    });
  }
  return { hourlyModel, seriesModel };
}

async function buildDashboardData(venueId, choice) {
  const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  const { hourlyModel, seriesModel } = choice;

  const [today, hourly, revenueTrend, topItems, periodTotals, cashOnHand] = await Promise.all([
    fetchTodayStats(venueId),
    fetchHourlyContext(venueId),
    fetchTrend('week', venueId),
    fetchTopItems('day', venueId, 5),
    fetchPeriodTotals(venueId),
    fetchCashOnHand(venueId),
  ]);

  const hourlyForecast = runHourlyForecast(hourlyModel, {
    todayHours: hourly.todayHours,
    yesterdayHours: hourly.yesterdayHours,
    currentHour: hourly.currentHour,
    sameWeekday: hourly.sameWeekday,
    weekday: hourly.weekday,
  });
  const seriesForecast = runSeriesForecast(seriesModel, {
    values: revenueTrend.map((point) => point.revenue),
  });

  return {
    venues,
    venueId,
    today,
    hourly,
    hourlyForecast,
    hourlyModel,
    seriesForecast,
    seriesModel,
    revenueTrend,
    topItems,
    periodTotals,
    cashOnHand,
  };
}

export async function renderDashboardFragment(venueId, choice = {}) {
  const resolved = {
    hourlyModel: resolveHourlyModel(choice.hourlyModel),
    seriesModel: resolveSeriesModel(choice.seriesModel),
  };
  const data = await buildDashboardData(venueId, resolved);
  return renderDashboardSection(data);
}

stats.get('/', async (c) => {
  const venueId = c.req.query('venueId') || null;
  return c.html(await renderDashboardFragment(venueId, forecastChoice(c)));
});

stats.get('/hourly', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const { hourlyModel } = forecastChoice(c);
  const hourly = await fetchHourlyContext(venueId);
  const forecast = runHourlyForecast(hourlyModel, {
    todayHours: hourly.todayHours,
    yesterdayHours: hourly.yesterdayHours,
    currentHour: hourly.currentHour,
    sameWeekday: hourly.sameWeekday,
    weekday: hourly.weekday,
  });
  return c.html(renderHourlyWidget({ hourly, forecast, venueId: venueId || '', hourlyModel }));
});

stats.get('/revenue', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const { seriesModel } = forecastChoice(c);
  const [trend, periodTotals] = await Promise.all([
    fetchTrend(period, venueId),
    fetchPeriodTotals(venueId),
  ]);
  const forecast = runSeriesForecast(seriesModel, {
    values: trend.map((point) => point.revenue),
  });
  return c.html(
    renderRevenueCard({
      trend,
      periodTotals,
      activePeriod: period,
      venueId: venueId || '',
      forecast,
      seriesModel,
    })
  );
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

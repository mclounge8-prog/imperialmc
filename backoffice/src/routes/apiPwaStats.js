import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { fetchAllVenues } from '../utils/venues.js';

/**
 * JSON-версия статистики «Главной» для мобильного PWA (public/pwa/).
 * Сутки в UTC, интервалы полуоткрытые [start, end) — как в stats.js.
 *
 * По каждой метрике отдаём:
 *  - 14-дневный тренд + «тень» недели назад (compareTrend) для спарклайна;
 *  - почасовой ряд выбранного дня и того же дня неделю назад — для детального
 *    dual-line графика как на «Главной» бэкофиса.
 */
const apiPwa = new Hono();
apiPwa.use('*', requireAuthApi);

const DAY_MS = 86400000;
const TREND_DAYS = 14;
const COMPARE_OFFSET_DAYS = 7;
const HOURS = 24;

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateParam(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return startOfUTCDay(new Date());
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(d.getTime()) ? startOfUTCDay(new Date()) : d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function emptyHours() {
  return new Array(HOURS).fill(0);
}

async function fetchReceiptsAndCash(rangeStart, rangeEnd, venueId) {
  const conditions = [`r.status = 'paid'`, `r.closed_at >= $1`, `r.closed_at < $2`];
  const params = [rangeStart.toISOString(), rangeEnd.toISOString()];
  if (venueId) {
    conditions.push(`r.venue_id = $3`);
    params.push(venueId);
  }

  const { rows: receiptRows } = await pool.query(
    `SELECT r.closed_at, r.total FROM receipts r WHERE ${conditions.join(' AND ')}`,
    params
  );

  const { rows: cashRows } = await pool.query(
    `SELECT r.closed_at, rp.amount
     FROM receipt_payments rp
     JOIN receipts r ON r.id = rp.receipt_id
     WHERE ${conditions.join(' AND ')} AND rp.method = 'cash'`,
    params
  );

  return { receiptRows, cashRows };
}

function buildDayBuckets(rangeStart, days) {
  const buckets = [];
  for (let i = 0; i < days; i += 1) {
    const start = new Date(rangeStart.getTime() + i * DAY_MS);
    buckets.push({
      date: fmtDate(start),
      startMs: start.getTime(),
      endMs: start.getTime() + DAY_MS,
      revenue: 0,
      receiptCount: 0,
      cash: 0,
    });
  }
  return buckets;
}

function bucketFor(buckets, closedAt) {
  const t = new Date(closedAt).getTime();
  return buckets.find((b) => t >= b.startMs && t < b.endMs);
}

function fillDayBuckets(buckets, receiptRows, cashRows) {
  for (const r of receiptRows) {
    const bucket = bucketFor(buckets, r.closed_at);
    if (!bucket) continue;
    bucket.revenue += Number(r.total);
    bucket.receiptCount += 1;
  }
  for (const r of cashRows) {
    const bucket = bucketFor(buckets, r.closed_at);
    if (!bucket) continue;
    bucket.cash += Number(r.amount);
  }
}

/**
 * Почасовые суммы за один UTC-день.
 * avgCheck[h] = revenue[h] / receiptCount[h] (0 если чеков нет).
 */
function buildHourlyForDay(dayStart, receiptRows, cashRows) {
  const startMs = dayStart.getTime();
  const endMs = startMs + DAY_MS;
  const revenue = emptyHours();
  const cash = emptyHours();
  const receiptCount = emptyHours();

  for (const r of receiptRows) {
    const t = new Date(r.closed_at).getTime();
    if (t < startMs || t >= endMs) continue;
    const hour = new Date(r.closed_at).getUTCHours();
    revenue[hour] += Number(r.total);
    receiptCount[hour] += 1;
  }
  for (const r of cashRows) {
    const t = new Date(r.closed_at).getTime();
    if (t < startMs || t >= endMs) continue;
    const hour = new Date(r.closed_at).getUTCHours();
    cash[hour] += Number(r.amount);
  }

  const avgCheck = revenue.map((v, i) => (receiptCount[i] > 0 ? v / receiptCount[i] : 0));
  return { revenue, cash, receiptCount, guestCount: receiptCount.slice(), avgCheck };
}

function avgCheckOf(b) {
  return b.receiptCount > 0 ? b.revenue / b.receiptCount : 0;
}

/**
 * Метрика: дневные значения + тень прошлой недели + почасовое сравнение.
 * allBuckets — TREND_DAYS + COMPARE_OFFSET_DAYS дней, последний = выбранный день.
 */
function buildMetric(allBuckets, selector, hoursSelected, hoursCompare) {
  const trendBuckets = allBuckets.slice(COMPARE_OFFSET_DAYS);
  const compareBuckets = allBuckets.slice(0, TREND_DAYS);
  const trend = trendBuckets.map(selector);
  const compareTrend = compareBuckets.map(selector);
  const lastIdx = trend.length - 1;
  const value = trend[lastIdx] || 0;
  const compareValue = compareTrend[lastIdx] || 0;
  const deltaAbs = value - compareValue;
  const deltaPct = compareValue === 0 ? (value === 0 ? 0 : 100) : (deltaAbs / compareValue) * 100;

  return {
    value,
    compareValue,
    deltaAbs,
    deltaPct,
    trend,
    compareTrend,
    hours: {
      selected: hoursSelected,
      compare: hoursCompare,
    },
  };
}

apiPwa.get('/venues', async (c) => {
  const venues = await fetchAllVenues();
  return c.json({ venues });
});

apiPwa.get('/stats', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const selectedDay = parseDateParam(c.req.query('date'));
  const compareDay = new Date(selectedDay.getTime() - COMPARE_OFFSET_DAYS * DAY_MS);
  const totalDays = TREND_DAYS + COMPARE_OFFSET_DAYS;
  const rangeStart = new Date(selectedDay.getTime() - (totalDays - 1) * DAY_MS);
  const rangeEnd = new Date(selectedDay.getTime() + DAY_MS);

  const { receiptRows, cashRows } = await fetchReceiptsAndCash(rangeStart, rangeEnd, venueId);
  const allBuckets = buildDayBuckets(rangeStart, totalDays);
  fillDayBuckets(allBuckets, receiptRows, cashRows);

  const selectedHours = buildHourlyForDay(selectedDay, receiptRows, cashRows);
  const compareHours = buildHourlyForDay(compareDay, receiptRows, cashRows);
  const hourLabels = Array.from({ length: HOURS }, (_, h) => String(h).padStart(2, '0'));

  const trendDates = allBuckets.slice(COMPARE_OFFSET_DAYS).map((b) => b.date);

  return c.json({
    date: fmtDate(selectedDay),
    compareDate: fmtDate(compareDay),
    dates: trendDates,
    hourLabels,
    compareOffsetDays: COMPARE_OFFSET_DAYS,
    venueId: venueId || null,
    metrics: {
      cash: buildMetric(allBuckets, (b) => b.cash, selectedHours.cash, compareHours.cash),
      revenue: buildMetric(allBuckets, (b) => b.revenue, selectedHours.revenue, compareHours.revenue),
      avgCheck: buildMetric(allBuckets, avgCheckOf, selectedHours.avgCheck, compareHours.avgCheck),
      receiptCount: buildMetric(
        allBuckets,
        (b) => b.receiptCount,
        selectedHours.receiptCount,
        compareHours.receiptCount
      ),
      guestCount: buildMetric(
        allBuckets,
        (b) => b.receiptCount,
        selectedHours.guestCount,
        compareHours.guestCount
      ),
    },
  });
});

export default apiPwa;

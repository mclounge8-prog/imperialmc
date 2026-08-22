import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { fetchAllVenues } from '../utils/venues.js';

/**
 * JSON-версия статистики «Главной» для мобильного PWA (public/pwa/).
 * Использует те же соглашения по датам, что и src/routes/stats.js — сутки
 * считаются в UTC, интервалы полуоткрытые [start, end) — иначе цифры между
 * бэкофисом и PWA будут расходиться на пограничных чеках у полуночи.
 */
const apiPwa = new Hono();
apiPwa.use('*', requireAuthApi);

const DAY_MS = 86400000;
const TREND_DAYS = 14;
const COMPARE_OFFSET_DAYS = 7; // сравниваем с тем же днём неделю назад — без «эффекта дня недели»

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

/**
 * Метрика для карточки: значение на выбранный день, значение для сравнения
 * (COMPARE_OFFSET_DAYS дней назад), дельта и 14-дневный тренд для спарклайна.
 */
function buildMetric(buckets, selector) {
  const trend = buckets.map(selector);
  const lastIdx = trend.length - 1;
  const compareIdx = lastIdx - COMPARE_OFFSET_DAYS;
  const value = trend[lastIdx] || 0;
  const compareValue = compareIdx >= 0 ? trend[compareIdx] || 0 : 0;
  const deltaAbs = value - compareValue;
  const deltaPct = compareValue === 0 ? (value === 0 ? 0 : 100) : (deltaAbs / compareValue) * 100;
  return { value, compareValue, deltaAbs, deltaPct, trend };
}

apiPwa.get('/venues', async (c) => {
  const venues = await fetchAllVenues();
  return c.json({ venues });
});

apiPwa.get('/stats', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const selectedDay = parseDateParam(c.req.query('date'));
  const rangeStart = new Date(selectedDay.getTime() - (TREND_DAYS - 1) * DAY_MS);
  const rangeEnd = new Date(selectedDay.getTime() + DAY_MS);

  const { receiptRows, cashRows } = await fetchReceiptsAndCash(rangeStart, rangeEnd, venueId);
  const buckets = buildDayBuckets(rangeStart, TREND_DAYS);

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

  const avgCheckOf = (b) => (b.receiptCount > 0 ? b.revenue / b.receiptCount : 0);
  const compareDay = new Date(selectedDay.getTime() - COMPARE_OFFSET_DAYS * DAY_MS);

  return c.json({
    date: fmtDate(selectedDay),
    compareDate: fmtDate(compareDay),
    venueId: venueId || null,
    metrics: {
      cash: buildMetric(buckets, (b) => b.cash),
      revenue: buildMetric(buckets, (b) => b.revenue),
      avgCheck: buildMetric(buckets, avgCheckOf),
      receiptCount: buildMetric(buckets, (b) => b.receiptCount),
      guestCount: buildMetric(buckets, (b) => b.receiptCount),
    },
  });
});

export default apiPwa;

import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderDashboardSection,
  renderRevenueWidgetBody,
  renderTopItemsWidgetBody,
  renderReceiptsCountWidgetBody,
} from '../views/statsView.js';

const stats = new Hono();
stats.use('*', requireAuthApi);

// ============================================================
// Границы бакетов для трендов «по дням / по неделям / по месяцам».
// Всё в UTC — так же, как и остальной бэкофис считает даты в reports.js
// (defaultDateRange там тоже работает через toISOString без смещения
// часового пояса). Если завести отдельный TZ для статистики, сутки в этом
// дэшборде разойдутся с сутками в разделе «Отчёты» — поэтому здесь
// сознательно та же конвенция.
// ============================================================

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function mondayOfWeek(dayStart) {
  const isoDay = dayStart.getUTCDay() === 0 ? 7 : dayStart.getUTCDay(); // 1..7, Пн..Вс
  return new Date(dayStart.getTime() - (isoDay - 1) * 86400000);
}

function buildDayBuckets(count, now) {
  const todayStart = startOfUTCDay(now);
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(todayStart.getTime() - i * 86400000);
    const end = new Date(start.getTime() + 86400000);
    buckets.push({ start, end, label: start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) });
  }
  return buckets;
}

function buildWeekBuckets(count, now) {
  const thisWeekStart = mondayOfWeek(startOfUTCDay(now));
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(thisWeekStart.getTime() - i * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    const endInclusive = new Date(end.getTime() - 86400000);
    const label = `${start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}–${endInclusive.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
    buckets.push({ start, end, label });
  }
  return buckets;
}

function buildMonthBuckets(count, now) {
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const label = start.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
    buckets.push({ start, end, label });
  }
  return buckets;
}

const TREND_BUCKET_COUNT = { day: 14, week: 8, month: 6 };
const TREND_BUILDERS = { day: buildDayBuckets, week: buildWeekBuckets, month: buildMonthBuckets };

function normalizePeriod(period) {
  return TREND_BUILDERS[period] ? period : 'day';
}

function buildTrendBuckets(period, now) {
  const safePeriod = normalizePeriod(period);
  return TREND_BUILDERS[safePeriod](TREND_BUCKET_COUNT[safePeriod], now);
}

// «Текущий период на сегодня» — для топ-5 блюд: не историческая серия,
// а срез «сегодня / текущая неделя / текущий месяц» на данный момент.
function currentPeriodRange(period, now) {
  const todayStart = startOfUTCDay(now);
  const safePeriod = normalizePeriod(period);
  if (safePeriod === 'week') {
    return { start: mondayOfWeek(todayStart), end: now };
  }
  if (safePeriod === 'month') {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: now };
  }
  return { start: todayStart, end: now };
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

// Одним запросом тянем все чеки за весь диапазон бакетов, дальше раскладываем
// по бакетам в памяти — бакетов максимум 14, а строк на бэкофис одного бара
// умеренное количество, гонять по запросу на бакет смысла нет.
async function fetchTrend(period, venueId) {
  const now = new Date();
  const buckets = buildTrendBuckets(period, now);
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
  const now = new Date();
  const { start, end } = currentPeriodRange(period, now);
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
  const todayStart = startOfUTCDay(now);
  const rows = await fetchPaidReceiptsInRange(todayStart, new Date(todayStart.getTime() + 86400000), venueId);
  const receiptCount = rows.length;
  const revenue = rows.reduce((sum, r) => sum + Number(r.total), 0);
  // Каждый чек (receipts) — это уже расчёт одного гостя (см. схему БД:
  // receipts создаётся на конкретного order_guest), так что кол-во чеков
  // и кол-во обслуженных гостей за период совпадают по построению.
  return {
    revenue,
    receiptCount,
    guestCount: receiptCount,
    avgCheck: receiptCount > 0 ? revenue / receiptCount : 0,
  };
}

async function fetchHourlyComparison(venueId) {
  const now = new Date();
  const todayStart = startOfUTCDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const rows = await fetchPaidReceiptsInRange(yesterdayStart, tomorrowStart, venueId);

  const todayHours = new Array(24).fill(0);
  const yesterdayHours = new Array(24).fill(0);
  const currentHour = now.getUTCHours();

  for (const r of rows) {
    const closedAt = new Date(r.closed_at);
    const hour = closedAt.getUTCHours();
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

  const [today, hourly, revenueTrend, topItems, receiptsTrend] = await Promise.all([
    fetchTodayStats(venueId),
    fetchHourlyComparison(venueId),
    fetchTrend('day', venueId),
    fetchTopItems('day', venueId),
    fetchTrend('day', venueId),
  ]);

  return { venues, venueId, today, hourly, revenueTrend, topItems, receiptsTrend };
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
  const trend = await fetchTrend(period, venueId);
  return c.html(renderRevenueWidgetBody(trend));
});

stats.get('/top-items', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const items = await fetchTopItems(period, venueId);
  return c.html(renderTopItemsWidgetBody(items));
});

stats.get('/receipts-count', async (c) => {
  const venueId = c.req.query('venueId') || null;
  const period = normalizePeriod(c.req.query('period'));
  const trend = await fetchTrend(period, venueId);
  return c.html(renderReceiptsCountWidgetBody(trend));
});

export default stats;

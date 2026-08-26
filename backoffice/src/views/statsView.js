import { escapeHtml } from './escapeHtml.js';
import {
  formatMoney,
  renderDeltaBadge,
  renderLineAreaChart,
  renderDualLineChart,
  renderTopItemsList,
  renderDonutChart,
} from './charts.js';

const PERIOD_TABS = [
  ['day', 'День'],
  ['week', 'Неделя'],
  ['month', 'Месяц'],
];

function renderWidgetTabs(widgetId, activePeriod, venueId, endpoint) {
  const venueQ = venueId || '';
  return `
    <div class="widget-tabs">
      ${PERIOD_TABS.map(
        ([key, label]) => `
        <button
          type="button"
          class="widget-tab${key === activePeriod ? ' widget-tab-active' : ''}"
          hx-get="${endpoint}?period=${key}&venueId=${venueQ}"
          hx-target="#${widgetId}-body"
          hx-swap="innerHTML"
          hx-on:click="this.closest('.widget-tabs').querySelectorAll('.widget-tab').forEach(b=>b.classList.remove('widget-tab-active')); this.classList.add('widget-tab-active')"
        >${label}</button>
      `
      ).join('')}
    </div>
  `;
}

function renderPeriodTotalsFooter(periodTotals) {
  if (!periodTotals) return '';
  const cells = [
    { label: 'Квартал', value: periodTotals.quarter },
    { label: 'Месяц', value: periodTotals.month },
    { label: 'Неделя', value: periodTotals.week },
    { label: 'День', value: periodTotals.day },
  ];
  return `
    <div class="period-totals">
      ${cells
        .map(
          (c) => `
        <div class="period-total-cell">
          <div class="period-total-label">${c.label}</div>
          <div class="period-total-value">${formatMoney(c.value)}</div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

/* ---------- Выручка (тренд + график) ---------- */

export function renderRevenueWidgetBody(trend, periodTotals, activePeriod = 'week') {
  const labels = trend.map((t) => t.label);
  const values = trend.map((t) => t.revenue);
  const total = values.reduce((s, v) => s + v, 0);
  const periodLabel =
    activePeriod === 'month' ? 'за месяцы на графике' : activePeriod === 'week' ? 'за недели на графике' : 'за дни на графике';

  return `
    <div class="stat-card-summary">
      <div class="stat-card-value">${formatMoney(total)}</div>
      <div class="stat-card-caption">${periodLabel}</div>
    </div>
    ${renderLineAreaChart({ labels, values, formatValue: (v) => formatMoney(v), height: 180 })}
    ${renderPeriodTotalsFooter(periodTotals)}
  `;
}

/* ---------- Топ блюд ---------- */

export function renderTopItemsWidgetBody(items) {
  return renderTopItemsList(items.map((i) => ({ name: i.name, qty: i.qty, revenue: i.revenue })));
}

export function renderTopItemsDonutBody(items) {
  return renderDonutChart(items.map((i) => ({ name: i.name, qty: i.qty, revenue: i.revenue })));
}

/* ---------- Сегодня ---------- */

function renderTodayWidget(today) {
  const delta = renderDeltaBadge(today.revenue, today.yesterdayRevenue || 0);
  return `
    <div class="stat-card today-card">
      <div class="widget-header">
        <h2>Сегодня</h2>
      </div>
      <div class="today-hero">
        <div class="today-hero-value">${formatMoney(today.revenue, { decimals: 2 })}</div>
        <div class="today-hero-compare">
          вчера ${formatMoney(today.yesterdayRevenue || 0, { decimals: 2 })}
          ${delta}
        </div>
      </div>
      <div class="today-metrics">
        <div class="today-metric">
          <div class="today-metric-label">Гости</div>
          <div class="today-metric-value">${today.guestCount}</div>
        </div>
        <div class="today-metric">
          <div class="today-metric-label">Чеки</div>
          <div class="today-metric-value">${today.receiptCount}</div>
        </div>
        <div class="today-metric">
          <div class="today-metric-label">Средний чек</div>
          <div class="today-metric-value">${formatMoney(today.avgCheck)}</div>
        </div>
        <div class="today-metric">
          <div class="today-metric-label">Вчера</div>
          <div class="today-metric-value">${formatMoney(today.yesterdayRevenue || 0)}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------- Выручка по часам ---------- */

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}`;
}

function renderHourlyWidget(hourly) {
  const labels = Array.from({ length: 24 }, (_, h) => hourLabel(h));
  const chart = renderDualLineChart({
    labels,
    seriesA: hourly.todayHours,
    seriesB: hourly.yesterdayHours,
    labelA: 'Сегодня',
    labelB: 'Вчера',
    formatValue: (v) => formatMoney(v),
    height: 200,
  });
  const delta = renderDeltaBadge(hourly.todayTotalSoFar, hourly.yesterdayTotalSameWindow);

  return `
    <div class="stat-card" id="hourly-widget">
      <div class="widget-header">
        <div>
          <h2>Выручка по часам</h2>
          <p class="hint">К этому часу: <strong>${formatMoney(hourly.todayTotalSoFar)}</strong> ${delta} к вчера (${formatMoney(hourly.yesterdayTotalSameWindow)})</p>
        </div>
      </div>
      ${chart}
    </div>
  `;
}

/* ---------- Полная сборка раздела «Главная» ---------- */

export function renderDashboardSection({
  venues,
  venueId,
  today,
  hourly,
  revenueTrend,
  topItems,
  periodTotals,
}) {
  const venueOptions =
    `<option value="">Все заведения</option>` +
    venues
      .map(
        (v) =>
          `<option value="${v.id}"${String(v.id) === String(venueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
      )
      .join('');

  return `
    <header class="dashboard-header">
      <div>
        <h1>Главная</h1>
        <p>Рабочий стол продаж</p>
      </div>
      <select
        class="venue-select dashboard-venue-select"
        name="venueId"
        hx-get="/stats"
        hx-trigger="change"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >${venueOptions}</select>
    </header>

    <div class="board-row board-row-2">
      ${renderHourlyWidget(hourly)}

      <div class="stat-card" id="revenue-widget">
        <div class="widget-header">
          <h2>Выручка</h2>
          ${renderWidgetTabs('revenue-widget', 'week', venueId, '/stats/revenue')}
        </div>
        <div id="revenue-widget-body">${renderRevenueWidgetBody(revenueTrend, periodTotals, 'week')}</div>
      </div>
    </div>

    <div class="board-row board-row-3">
      ${renderTodayWidget(today)}

      <div class="stat-card" id="top-items-widget">
        <div class="widget-header">
          <h2>Топ блюд</h2>
          ${renderWidgetTabs('top-items-widget', 'day', venueId, '/stats/top-items')}
        </div>
        <div id="top-items-widget-body">${renderTopItemsWidgetBody(topItems)}</div>
      </div>

      <div class="stat-card" id="top-items-donut-widget">
        <div class="widget-header">
          <h2>Топ 5 блюд</h2>
          ${renderWidgetTabs('top-items-donut-widget', 'day', venueId, '/stats/top-items-donut')}
        </div>
        <div id="top-items-donut-widget-body">${renderTopItemsDonutBody(topItems)}</div>
      </div>
    </div>
  `;
}

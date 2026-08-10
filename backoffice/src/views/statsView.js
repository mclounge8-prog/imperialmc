import { escapeHtml } from './escapeHtml.js';
import {
  formatMoney,
  renderDeltaBadge,
  renderLineAreaChart,
  renderBarChart,
  renderDualLineChart,
  renderTopItemsList,
} from './charts.js';

const PERIOD_TABS = [
  ['week', 'Недели'],
  ['day', 'Дни'],
  ['month', 'Месяцы'],
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

/* ---------- Выручка (тренд + график) ---------- */

export function renderRevenueWidgetBody(trend) {
  const labels = trend.map((t) => t.label);
  const values = trend.map((t) => t.revenue);
  const total = values.reduce((s, v) => s + v, 0);

  return `
    <div class="stat-card-summary">
      <div class="stat-card-value">${formatMoney(total)}</div>
      <div class="stat-card-caption">суммарно за период на графике</div>
    </div>
    ${renderLineAreaChart({ labels, values, formatValue: (v) => formatMoney(v) })}
  `;
}

/* ---------- Топ 5 блюд ---------- */

export function renderTopItemsWidgetBody(items) {
  return renderTopItemsList(items.map((i) => ({ name: i.name, qty: i.qty, revenue: i.revenue })));
}

/* ---------- Кол-во чеков (тренд + график) ---------- */

export function renderReceiptsCountWidgetBody(trend) {
  const labels = trend.map((t) => t.label);
  const values = trend.map((t) => t.count);
  const total = values.reduce((s, v) => s + v, 0);

  return `
    <div class="stat-card-summary">
      <div class="stat-card-value">${total}</div>
      <div class="stat-card-caption">чеков за период на графике</div>
    </div>
    ${renderBarChart({ labels, values, formatValue: (v) => `${v} чек.` })}
  `;
}

/* ---------- Сегодня (KPI-карточки) ---------- */

function renderTodayCards(today) {
  const cards = [
    { label: 'Выручка сегодня', value: formatMoney(today.revenue) },
    { label: 'Чеков', value: String(today.receiptCount) },
    { label: 'Гостей', value: String(today.guestCount) },
    { label: 'Средний чек', value: formatMoney(today.avgCheck) },
  ];

  return `
    <div class="kpi-grid">
      ${cards
        .map(
          (c) => `
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(c.label)}</div>
          <div class="kpi-value">${c.value}</div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

/* ---------- Выручка по часам (сегодня vs вчера) ---------- */

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
  });
  const delta = renderDeltaBadge(hourly.todayTotalSoFar, hourly.yesterdayTotalSameWindow);

  return `
    <div class="stat-card" id="hourly-widget">
      <div class="widget-header">
        <div>
          <h2>Выручка по часам</h2>
          <p class="hint">Сегодня к этому же часу: <strong>${formatMoney(hourly.todayTotalSoFar)}</strong> ${delta} к вчера (${formatMoney(hourly.yesterdayTotalSameWindow)})</p>
        </div>
      </div>
      ${chart}
    </div>
  `;
}

/* ---------- Полная сборка раздела «Главная» ---------- */

export function renderDashboardSection({ venues, venueId, today, hourly, revenueTrend, topItems, receiptsTrend }) {
  const venueOptions =
    `<option value="">Все заведения</option>` +
    venues
      .map(
        (v) =>
          `<option value="${v.id}"${String(v.id) === String(venueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
      )
      .join('');

  return `
    <header>
      <h1>Главная</h1>
      <p>Обзор продаж по всем заведениям</p>
    </header>

    <div class="subsection">
      <select
        class="venue-select"
        name="venueId"
        hx-get="/stats"
        hx-trigger="change"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >${venueOptions}</select>
    </div>

    <div class="subsection">
      ${renderTodayCards(today)}
    </div>

    <div class="subsection">
      ${renderHourlyWidget(hourly)}
    </div>

    <div class="subsection stats-grid-2">
      <div class="stat-card" id="revenue-widget">
        <div class="widget-header">
          <h2>Выручка</h2>
          ${renderWidgetTabs('revenue-widget', 'day', venueId, '/stats/revenue')}
        </div>
        <div id="revenue-widget-body">${renderRevenueWidgetBody(revenueTrend)}</div>
      </div>

      <div class="stat-card" id="top-items-widget">
        <div class="widget-header">
          <h2>Топ 5 блюд</h2>
          ${renderWidgetTabs('top-items-widget', 'day', venueId, '/stats/top-items')}
        </div>
        <div id="top-items-widget-body">${renderTopItemsWidgetBody(topItems)}</div>
      </div>
    </div>

    <div class="subsection">
      <div class="stat-card" id="receipts-count-widget">
        <div class="widget-header">
          <h2>Количество чеков</h2>
          ${renderWidgetTabs('receipts-count-widget', 'day', venueId, '/stats/receipts-count')}
        </div>
        <div id="receipts-count-widget-body">${renderReceiptsCountWidgetBody(receiptsTrend)}</div>
      </div>
    </div>
  `;
}

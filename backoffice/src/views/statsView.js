import { escapeHtml } from './escapeHtml.js';
import {
  formatMoney,
  formatDelta,
  renderLineAreaChart,
  renderDualLineChart,
  renderTopItemsList,
  renderDonutChart,
} from './charts.js';
import { listHourlyModels, listSeriesModels, weekdayPhrase, trendWords } from '../services/revenueForecast.js';

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

function qs(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

function renderForecastModels({ models, activeId, target, urlFor }) {
  return `
    <div class="forecast-models">
      ${models
        .map(
          (model) => `
        <button
          type="button"
          class="forecast-model${model.id === activeId ? ' is-active' : ''}"
          title="${escapeHtml(model.hint)}"
          hx-get="${urlFor(model.id)}"
          hx-target="${target}"
          hx-swap="outerHTML"
        >${escapeHtml(model.label)}</button>`
        )
        .join('')}
    </div>
  `;
}

const SERIES_PERIOD_COPY = {
  day: { unit: 'дней', tail: 'Текущий день не входит' },
  week: { unit: 'недель', tail: 'Текущая неделя не входит' },
  month: { unit: 'месяцев', tail: 'Текущий месяц не входит' },
};

function renderSeriesForecastStrip({ forecast, period, venueId, seriesModel }) {
  const copy = SERIES_PERIOD_COPY[period] || SERIES_PERIOD_COPY.week;
  const activeId = forecast?.requestedModelId || seriesModel;
  const buttons = renderForecastModels({
    models: listSeriesModels(),
    activeId,
    target: '#revenue-widget',
    urlFor: (id) => `/stats/revenue?${qs({ period, venueId, seriesModel: id })}`,
  });

  const words = forecast?.ok ? trendWords(forecast.sign, forecast.pct) : null;
  const modelPlain = listSeriesModels().find((model) => model.id === (forecast?.modelId || activeId))?.plain || '';
  const headline = words ? words.title : 'Пока мало закрытых периодов';
  const note = forecast?.ok
    ? `${forecast.pointKind === 'slope' ? 'Так ползут уже закрытые' : 'Недавние закрытые'} ${copy.unit} против предыдущих. ${copy.tail}. Ориентир ${formatMoney(forecast.nextValue)}.`
    : escapeHtml(forecast?.reason || 'Недостаточно закрытых периодов');

  return `
    <div class="forecast-strip" data-forecast="series" data-forecast-model="${escapeHtml(activeId || '')}">
      <div class="forecast-plain-title ${words ? words.sign : 'flat'}">${escapeHtml(headline)}</div>
      <p class="forecast-note">${note}</p>
      ${modelPlain ? `<p class="forecast-note">${escapeHtml(modelPlain)}</p>` : ''}
      ${buttons}
      <input type="hidden" id="series-model-field" name="seriesModel" value="${escapeHtml(activeId || '')}">
    </div>
  `;
}

function hourlyCompareLabels(forecast) {
  if (forecast.compareWith === 'yesterday') {
    return { pace: 'к вчерашнему часу', close: 'к вчерашнему дню' };
  }
  const days = weekdayPhrase(forecast.weekday);
  return { pace: `к обычным ${days}`, close: `к обычным ${days}` };
}

function hourlyForecastSeries(hourly, forecast) {
  if (!forecast?.ok || !forecast.projected) return null;
  const hasFuture = forecast.projected.some((value, hour) => hour > hourly.currentHour && value != null);
  if (!hasFuture) return null;
  return forecast.projected.map((value, hour) => {
    if (hour < hourly.currentHour) return null;
    if (hour === hourly.currentHour) return hourly.todayHours[hour];
    return value;
  });
}

function renderHourlyForecastStrip({ forecast, venueId, hourlyModel }) {
  const activeId = forecast?.requestedModelId || hourlyModel;
  const buttons = renderForecastModels({
    models: listHourlyModels(),
    activeId,
    target: '#hourly-widget',
    urlFor: (id) => `/stats/hourly?${qs({ venueId, hourlyModel: id })}`,
  });

  if (!forecast?.ok) {
    return `
      <div class="forecast-strip" data-forecast="hourly" data-forecast-model="${escapeHtml(activeId || '')}">
        <div class="forecast-plain-title flat">Пока без прогноза на день</div>
        <p class="forecast-note">${escapeHtml(forecast?.reason || 'Нет базы для прогноза')}</p>
        ${buttons}
        <input type="hidden" id="hourly-model-field" name="hourlyModel" value="${escapeHtml(activeId || '')}">
      </div>
    `;
  }

  const labels = hourlyCompareLabels(forecast);
  const paceWords = trendWords(forecast.sign, forecast.pct, { ongoing: true });
  const closeDelta = formatDelta(forecast.closeForecast, forecast.closeBaseline);
  const closeWords = trendWords(closeDelta.sign, closeDelta.pct);
  const closeSign = closeWords.sign;
  const modelPlain = listHourlyModels().find((model) => model.id === forecast.modelId)?.plain || '';
  const notes = [];
  if (forecast.fellBack) {
    const requested = listHourlyModels().find((model) => model.id === forecast.requestedModelId);
    notes.push(
      `${requested?.label || 'Этот способ'} сейчас не посчитать. Показан способ «${forecast.modelLabel}».`
    );
  }
  if (forecast.confidence === 'low') notes.push('До полудня процент ещё легко меняется.');
  if (forecast.confidence === 'early') notes.push('До выручки показываем, как обычно заканчивается такой день.');
  if (forecast.capped) notes.push('Утро ещё короткое, слишком резкий скачок мы придержали.');
  if (forecast.compareWith === 'weekday') notes.push(`Считаем по ${forecast.baselineDays} обычным ${weekdayPhrase(forecast.weekday)}.`);
  const noteText = notes.filter(Boolean).join(' ');
  const paceTitle = forecast.confidence === 'early' ? 'День ещё не разошёлся' : paceWords.title;
  const paceHint =
    forecast.confidence === 'early'
      ? 'Рано говорить, выше сегодня обычного или ниже.'
      : `По уже закрытым часам, ${labels.pace}.`;

  return `
    <div class="forecast-strip" data-forecast="hourly" data-forecast-model="${escapeHtml(forecast.modelId)}">
      <div class="forecast-plain-title ${forecast.confidence === 'early' ? 'flat' : paceWords.sign}">${escapeHtml(paceTitle)}</div>
      <p class="forecast-note">${escapeHtml(paceHint)}</p>
      <p class="forecast-close">К закрытию около <strong>${formatMoney(forecast.closeForecast)}</strong></p>
      <p class="forecast-note ${closeWords.sign}">${escapeHtml(closeWords.title)}. ${escapeHtml(labels.close)}.</p>
      ${modelPlain ? `<p class="forecast-note">${escapeHtml(modelPlain)}</p>` : ''}
      ${noteText ? `<p class="forecast-note">${escapeHtml(noteText)}</p>` : ''}
      ${buttons}
      <input type="hidden" id="hourly-model-field" name="hourlyModel" value="${escapeHtml(activeId || '')}">
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

export function renderRevenueWidgetBody(trend, periodTotals, activePeriod = 'week', forecast = null, venueId = '', seriesModel = 'halfCompare') {
  const labels = trend.map((t) => t.label);
  const values = trend.map((t) => t.revenue);
  const total = values.reduce((s, v) => s + v, 0);
  const periodLabel =
    activePeriod === 'month' ? 'за месяцы на графике' : activePeriod === 'week' ? 'за недели на графике' : 'за дни на графике';

  return `
    ${renderSeriesForecastStrip({ forecast, period: activePeriod, venueId, seriesModel })}
    <div class="stat-card-summary">
      <div class="stat-card-value">${formatMoney(total)}</div>
      <div class="stat-card-caption">${periodLabel}</div>
    </div>
    ${renderLineAreaChart({ labels, values, formatValue: (v) => formatMoney(v), height: 180 })}
    ${renderPeriodTotalsFooter(periodTotals)}
  `;
}

export function renderRevenueCard({ trend, periodTotals, activePeriod = 'week', venueId = '', forecast = null, seriesModel = 'halfCompare' }) {
  const tabs = PERIOD_TABS.map(
    ([key, label]) => `
        <button
          type="button"
          class="widget-tab${key === activePeriod ? ' widget-tab-active' : ''}"
          hx-get="/stats/revenue?${qs({ period: key, venueId, seriesModel })}"
          hx-target="#revenue-widget"
          hx-swap="outerHTML"
        >${label}</button>`
  ).join('');

  return `
    <div class="stat-card" id="revenue-widget">
      <div class="widget-header">
        <h2>Выручка</h2>
        <div class="widget-tabs">${tabs}</div>
      </div>
      <div id="revenue-widget-body">${renderRevenueWidgetBody(trend, periodTotals, activePeriod, forecast, venueId, seriesModel)}</div>
    </div>
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
  const sameWindow = today.yesterdaySameWindow ?? today.yesterdayRevenue ?? 0;
  const delta = formatDelta(today.revenue, sameWindow);
  const words = trendWords(delta.sign, delta.pct, { ongoing: true });
  return `
    <div class="stat-card today-card">
      <div class="widget-header">
        <h2>Сегодня</h2>
      </div>
      <div class="today-hero">
        <div class="today-hero-value">${formatMoney(today.revenue, { decimals: 2 })}</div>
        <div class="today-hero-compare">
          <span class="forecast-plain-title ${words.sign}">${escapeHtml(words.title)}</span>
          <span>к вчерашнему часу, тогда было ${formatMoney(sameWindow, { decimals: 2 })}</span>
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
          <div class="today-metric-label">Вчера целиком</div>
          <div class="today-metric-value">${formatMoney(today.yesterdayRevenue || 0)}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------- Наличка сейчас ---------- */

function renderCashOnHandWidget(cashOnHand) {
  const venues = cashOnHand?.venues || [];
  const total = cashOnHand?.total || 0;
  const openCount = venues.filter((v) => v.hasOpenShift).length;
  const rows =
    venues.length === 0
      ? `<p class="hint cash-on-hand-empty">Нет заведений</p>`
      : `
        <ul class="cash-on-hand-list">
          ${venues
            .map(
              (v) => `
            <li class="cash-on-hand-row${v.hasOpenShift ? '' : ' is-closed'}">
              <span class="cash-on-hand-venue">${escapeHtml(v.venueName)}</span>
              <span class="cash-on-hand-amount">${
                v.hasOpenShift ? formatMoney(v.expectedCash, { decimals: 2 }) : 'смена закрыта'
              }</span>
            </li>
          `
            )
            .join('')}
        </ul>
      `;

  return `
    <div class="stat-card cash-on-hand-card" id="cash-on-hand-widget">
      <div class="widget-header">
        <div>
          <h2>Наличка</h2>
          <p class="hint">Сейчас в кассе по открытым сменам${
            openCount ? ` · ${openCount} откр.` : ''
          }</p>
        </div>
      </div>
      <div class="stat-card-summary">
        <div class="stat-card-value">${formatMoney(total, { decimals: 2 })}</div>
        <div class="stat-card-caption">всего</div>
      </div>
      ${rows}
    </div>
  `;
}

/* ---------- Выручка по часам ---------- */

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}`;
}

export function renderHourlyWidget({ hourly, forecast = null, venueId = '', hourlyModel = 'weekdayProfile' }) {
  const labels = Array.from({ length: 24 }, (_, h) => hourLabel(h));
  const todaySeries = hourly.todayHours.map((value, hour) => (hour <= hourly.currentHour ? value : null));
  const chart = renderDualLineChart({
    labels,
    seriesA: todaySeries,
    seriesB: hourly.yesterdayHours,
    seriesC: hourlyForecastSeries(hourly, forecast),
    labelA: 'Сегодня',
    labelB: 'Вчера',
    labelC: 'Прогноз',
    formatValue: (v) => formatMoney(v),
    height: 200,
  });

  return `
    <div class="stat-card" id="hourly-widget">
      <div class="widget-header">
        <div>
          <h2>Выручка по часам</h2>
          <p class="hint">Сейчас <strong>${formatMoney(hourly.todayTotalSoFar)}</strong>, вчера к этому часу ${formatMoney(hourly.yesterdayTotalSameWindow)}</p>
        </div>
      </div>
      ${renderHourlyForecastStrip({ forecast, venueId, hourlyModel })}
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
  hourlyForecast,
  hourlyModel,
  seriesForecast,
  seriesModel,
  revenueTrend,
  topItems,
  periodTotals,
  cashOnHand,
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
        hx-include="#hourly-model-field,#series-model-field"
      >${venueOptions}</select>
    </header>

    <div class="board-row board-row-cash">
      ${renderCashOnHandWidget(cashOnHand)}
    </div>

    <div class="board-row board-row-2">
      ${renderHourlyWidget({ hourly, forecast: hourlyForecast, venueId, hourlyModel })}
      ${renderRevenueCard({
        trend: revenueTrend,
        periodTotals,
        activePeriod: 'week',
        venueId,
        forecast: seriesForecast,
        seriesModel,
      })}
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

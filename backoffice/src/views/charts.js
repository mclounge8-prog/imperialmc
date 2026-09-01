import { escapeHtml } from './escapeHtml.js';

// Палитра под айдентику бэкофиса (см. :root в public/css/style.css) — здесь
// продублирована как есть, потому что графики рисуются server-side как чистый
// SVG и не имеют доступа к CSS-переменным браузера.
export const CHART_COLORS = {
  accent: '#2647c7',
  accent2: '#3f63e6',
  accent2Fill: 'rgba(63, 99, 230, 0.22)',
  muted: '#98979f',
  mutedFill: 'rgba(152, 151, 159, 0.12)',
  grid: '#34343c',
  text: '#98979f',
  bg: '#1b1b1f',
  // Сегменты donut — оттенки брендового синего + нейтрали
  donut: ['#3f63e6', '#2647c7', '#5b7cf0', '#7a93f5', '#98979f'],
};

export function formatMoney(value, { decimals = 0 } = {}) {
  const num = Number(value) || 0;
  return `${num.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ₽`;
}

export function formatDelta(current, previous) {
  if (previous === 0) {
    if (current === 0) return { pct: 0, sign: 'flat' };
    return { pct: 100, sign: 'up' };
  }
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.abs(pct), sign: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' };
}

export function renderDeltaBadge(current, previous) {
  const { pct, sign } = formatDelta(current, previous);
  const arrow = sign === 'up' ? '▲' : sign === 'down' ? '▼' : '●';
  const cls = sign === 'up' ? 'delta-up' : sign === 'down' ? 'delta-down' : 'delta-flat';
  return `<span class="delta-badge ${cls}">${arrow} ${pct.toFixed(0)}%</span>`;
}

const CHART_WIDTH = 640;

function scaleY(value, maxValue, height, padTop) {
  const usable = height - padTop;
  if (maxValue <= 0) return height;
  return height - (value / maxValue) * usable;
}

function buildLinePath(values, maxValue, width, height, padTop) {
  if (values.length === 0) return '';
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = scaleY(v, maxValue, height, padTop);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function gridLinesSvg(width, height, padTop) {
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  return fractions
    .map((f) => {
      const y = height - f * (height - padTop);
      return `<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="${CHART_COLORS.grid}" stroke-width="1" stroke-dasharray="4 4" />`;
    })
    .join('');
}

function labelsRow(labels) {
  return `<div class="chart-labels">${labels.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>`;
}

/**
 * Компактная запись числа для подписей оси Y (4K, 3.5K, 250 и т. д.) —
 * полные суммы с ₽ и разделителями разрядов туда просто не влезают.
 */
function formatCompactAxis(value) {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  const trim = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  if (abs >= 1_000_000) return `${trim(num / 1_000_000)}M`;
  if (abs >= 1000) return `${trim(num / 1000)}K`;
  return `${Math.round(num)}`;
}

/**
 * Подписи оси Y слева от графика — те же горизонтальные отметки, что рисует
 * gridLinesSvg, но вынесены в обычный HTML (а не текст внутри SVG), потому что
 * SVG растягивается через preserveAspectRatio="none" и текст внутри него плыл
 * бы по горизонтали вместе с линиями.
 */
function yAxisColumn(maxValue, height, padTop) {
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const ticks = fractions
    .map((f) => {
      const y = height - f * (height - padTop);
      const translate = f === 1 ? '0' : f === 0 ? '-100%' : '-50%';
      return `<span class="chart-y-axis-tick" style="top:${y.toFixed(1)}px; transform:translateY(${translate})">${escapeHtml(
        formatCompactAxis(f * maxValue)
      )}</span>`;
    })
    .join('');
  return `<div class="chart-y-axis" style="height:${height}px">${ticks}</div>`;
}

/**
 * Слой наведения: невидимая область поверх графика, которая по mousemove
 * находит ближайшую точку (через Alpine, см. window.chartTooltip в app.js) и
 * показывает вертикальную линию-«прицел» + всплывающую подсказку с числами.
 * Раньше подсказки жили в <title> у SVG-точек — это нативный тултип браузера
 * с большой задержкой и крошечной областью наведения (только сам кружок
 * радиусом 3px), из-за чего казалось, что при наведении вообще ничего не
 * происходит.
 */
function hoverLayer(points, height, svg) {
  const pointsAttr = escapeHtml(JSON.stringify(points));
  return `
    <div
      class="chart-plot"
      style="height:${height}px"
      x-data="chartTooltip(${pointsAttr})"
      @mousemove="onMove($event)"
      @mouseleave="hide()"
    >
      ${svg}
      <div class="chart-crosshair" x-show="active" x-cloak :style="'left:' + (active ? active.xPct : 0) + '%'"></div>
      <template x-for="row in (active ? active.rows : [])" :key="row.name || row.color">
        <div class="chart-hover-dot" :style="'left:' + active.xPct + '%; top:' + row.yPct + '%; background:' + row.color"></div>
      </template>
      <div class="chart-tooltip" x-show="active" x-cloak :style="tooltipStyle">
        <div class="chart-tooltip-label" x-text="active ? active.label : ''"></div>
        <template x-for="row in (active ? active.rows : [])" :key="row.name || row.color">
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-dot" :style="'background:' + row.color"></span>
            <span class="chart-tooltip-name" x-text="row.name"></span>
            <span class="chart-tooltip-value" x-text="row.value"></span>
          </div>
        </template>
      </div>
    </div>
  `;
}

/**
 * Линия + залитая область под ней — для трендов (выручка, кол-во чеков во
 * времени). Один ряд значений.
 */
export function renderLineAreaChart({ labels, values, formatValue = (v) => String(v), height = 200 }) {
  const width = CHART_WIDTH;
  const padTop = 14;
  const maxValue = Math.max(1, ...values);
  const linePath = buildLinePath(values, maxValue, width, height, padTop);
  const areaPath = values.length ? `${linePath} L${width},${height} L0,${height} Z` : '';
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const dots = values
    .map((v, i) => {
      const x = i * stepX;
      const y = scaleY(v, maxValue, height, padTop);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${CHART_COLORS.accent2}" stroke="${CHART_COLORS.bg || '#121214'}" stroke-width="1.5" />`;
    })
    .join('');

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" role="img" aria-label="График">
      ${gridLinesSvg(width, height, padTop)}
      <path d="${areaPath}" fill="${CHART_COLORS.accent2Fill}" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${CHART_COLORS.accent2}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>
  `;

  const points = values.map((v, i) => ({
    xPct: stepX ? (i / (values.length - 1)) * 100 : 50,
    label: labels[i] || '',
    rows: [
      {
        name: '',
        value: formatValue(v),
        color: CHART_COLORS.accent2,
        yPct: (scaleY(v, maxValue, height, padTop) / height) * 100,
      },
    ],
  }));

  return `
    <div class="chart-wrap">
      <div class="chart-with-axis">
        ${yAxisColumn(maxValue, height, padTop)}
        ${hoverLayer(points, height, svg)}
      </div>
      ${labelsRow(labels)}
    </div>
  `;
}

/**
 * Столбики — для «Кол-во чеков» и подобных величин, где точнее смотрится
 * дискретный график, а не сплошная линия.
 */
export function renderBarChart({ labels, values, formatValue = (v) => String(v), height = 200, color = CHART_COLORS.accent2 }) {
  const width = CHART_WIDTH;
  const padTop = 14;
  const maxValue = Math.max(1, ...values);
  const gap = values.length ? width / values.length : width;
  const barWidth = Math.max(4, gap * 0.55);

  const bars = values
    .map((v, i) => {
      const barHeight = maxValue > 0 ? (v / maxValue) * (height - padTop) : 0;
      const x = i * gap + (gap - barWidth) / 2;
      const y = height - barHeight;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, barHeight).toFixed(1)}" rx="3" fill="${color}"><title>${escapeHtml(labels[i] || '')}: ${escapeHtml(formatValue(v))}</title></rect>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" role="img" aria-label="График">
        ${gridLinesSvg(width, height, padTop)}
        ${bars}
      </svg>
      ${labelsRow(labels)}
    </div>
  `;
}

/**
 * Два ряда линий на одном графике — для сравнения «сегодня» / «вчера» по часам.
 * seriesA рисуется акцентным цветом (текущий период), seriesB — приглушённым
 * пунктиром (предыдущий период для сравнения).
 */
export function renderDualLineChart({
  labels,
  seriesA,
  seriesB,
  labelA,
  labelB,
  formatValue = (v) => String(v),
  height = 200,
}) {
  const width = CHART_WIDTH;
  const padTop = 14;
  const maxValue = Math.max(1, ...seriesA, ...seriesB);
  const pathA = buildLinePath(seriesA, maxValue, width, height, padTop);
  const pathB = buildLinePath(seriesB, maxValue, width, height, padTop);
  const stepX = seriesA.length > 1 ? width / (seriesA.length - 1) : 0;

  const dotsA = seriesA
    .map((v, i) => {
      const x = i * stepX;
      const y = scaleY(v, maxValue, height, padTop);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${CHART_COLORS.accent2}" />`;
    })
    .join('');

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" role="img" aria-label="График">
      ${gridLinesSvg(width, height, padTop)}
      <path d="${pathB}" fill="none" stroke="${CHART_COLORS.muted}" stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round" stroke-linecap="round" />
      <path d="${pathA}" fill="none" stroke="${CHART_COLORS.accent2}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dotsA}
    </svg>
  `;

  const points = seriesA.map((v, i) => ({
    xPct: stepX ? (i / (seriesA.length - 1)) * 100 : 50,
    label: labels[i] || '',
    rows: [
      {
        name: labelA,
        value: formatValue(v),
        color: CHART_COLORS.accent2,
        yPct: (scaleY(v, maxValue, height, padTop) / height) * 100,
      },
      {
        name: labelB,
        value: formatValue(seriesB[i] ?? 0),
        color: CHART_COLORS.muted,
        yPct: (scaleY(seriesB[i] ?? 0, maxValue, height, padTop) / height) * 100,
      },
    ],
  }));

  return `
    <div class="chart-wrap">
      <div class="chart-with-axis">
        ${yAxisColumn(maxValue, height, padTop)}
        ${hoverLayer(points, height, svg)}
      </div>
      ${labelsRow(labels)}
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="chart-legend-dot" style="background:${CHART_COLORS.accent2}"></span>${escapeHtml(labelA)}</span>
        <span class="chart-legend-item"><span class="chart-legend-dot chart-legend-dot-dashed" style="border-color:${CHART_COLORS.muted}"></span>${escapeHtml(labelB)}</span>
      </div>
    </div>
  `;
}

/**
 * Горизонтальные бары-рейтинг (не SVG-график, а список с CSS-барами) — для
 * топа позиций меню, где важнее читаемое название, чем точность оси.
 */
export function renderTopItemsList(items) {
  if (items.length === 0) {
    return `<p class="empty-hint">За этот период продаж нет</p>`;
  }

  const maxRevenue = Math.max(1, ...items.map((i) => Number(i.revenue)));

  return `
    <div class="top-items-list">
      <div class="top-items-head">
        <span>Блюдо</span>
        <span>Выручка, ₽</span>
      </div>
      ${items
        .map((item, idx) => {
          const revenue = Number(item.revenue);
          const pct = Math.max(4, (revenue / maxRevenue) * 100);
          return `
            <div class="top-item-row">
              <span class="top-item-rank">${idx + 1}</span>
              <div class="top-item-info">
                <div class="top-item-name">${escapeHtml(item.name)}</div>
                <div class="top-item-bar-track"><div class="top-item-bar-fill" style="width:${pct.toFixed(0)}%"></div></div>
              </div>
              <div class="top-item-stats">
                <span class="top-item-revenue">${formatMoney(revenue)}</span>
                <span class="top-item-qty">${item.qty} шт</span>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * Donut для топ-блюд. В центре — лидер и его доля.
 */
export function renderDonutChart(items) {
  if (!items.length) {
    return `<p class="empty-hint">За этот период продаж нет</p>`;
  }

  const total = items.reduce((s, i) => s + Number(i.revenue), 0) || 1;
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const stroke = 28;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = items
    .map((item, idx) => {
      const value = Number(item.revenue);
      const share = value / total;
      const dash = share * circumference;
      const gap = circumference - dash;
      const color = CHART_COLORS.donut[idx % CHART_COLORS.donut.length];
      const el = `
        <circle
          cx="${cx}" cy="${cy}" r="${r}"
          fill="none"
          stroke="${color}"
          stroke-width="${stroke}"
          stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
          transform="rotate(-90 ${cx} ${cy})"
        >
          <title>${escapeHtml(item.name)}: ${formatMoney(value)} (${(share * 100).toFixed(0)}%)</title>
        </circle>
      `;
      offset += dash;
      return el;
    })
    .join('');

  const leader = items[0];
  const leaderShare = ((Number(leader.revenue) / total) * 100).toFixed(0);

  const legend = items
    .map((item, idx) => {
      const value = Number(item.revenue);
      const share = ((value / total) * 100).toFixed(0);
      const color = CHART_COLORS.donut[idx % CHART_COLORS.donut.length];
      return `
        <div class="donut-legend-row">
          <span class="donut-swatch" style="background:${color}"></span>
          <span class="donut-legend-pct">${share}%</span>
          <span class="donut-legend-name">${escapeHtml(item.name)}</span>
          <span class="donut-legend-val">${formatMoney(value)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="donut-layout">
      <div class="donut-chart-wrap">
        <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="Топ блюд">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${CHART_COLORS.grid}" stroke-width="${stroke}" />
          ${segments}
        </svg>
        <div class="donut-center">
          <div class="donut-center-pct">${leaderShare}%</div>
          <div class="donut-center-name">${escapeHtml(leader.name)}</div>
        </div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

import { escapeHtml } from './escapeHtml.js';

// Палитра под айдентику бэкофиса (см. :root в public/css/style.css) — здесь
// продублирована как есть, потому что графики рисуются server-side как чистый
// SVG и не имеют доступа к CSS-переменным браузера.
export const CHART_COLORS = {
  accent: '#2647c7',
  accent2: '#3f63e6',
  accent2Fill: 'rgba(63, 99, 230, 0.16)',
  muted: '#98979f',
  mutedFill: 'rgba(152, 151, 159, 0.12)',
  grid: '#34343c',
  text: '#98979f',
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
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${CHART_COLORS.accent2}" stroke="${CHART_COLORS.bg || '#121214'}" stroke-width="1.5"><title>${escapeHtml(labels[i] || '')}: ${escapeHtml(formatValue(v))}</title></circle>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" role="img" aria-label="График">
        ${gridLinesSvg(width, height, padTop)}
        <path d="${areaPath}" fill="${CHART_COLORS.accent2Fill}" stroke="none" />
        <path d="${linePath}" fill="none" stroke="${CHART_COLORS.accent2}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
      </svg>
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
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${CHART_COLORS.accent2}"><title>${escapeHtml(labels[i] || '')} · ${escapeHtml(labelA)}: ${escapeHtml(formatValue(v))}</title></circle>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" role="img" aria-label="График">
        ${gridLinesSvg(width, height, padTop)}
        <path d="${pathB}" fill="none" stroke="${CHART_COLORS.muted}" stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round" stroke-linecap="round" />
        <path d="${pathA}" fill="none" stroke="${CHART_COLORS.accent2}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${dotsA}
      </svg>
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

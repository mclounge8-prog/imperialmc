import { escapeHtml } from './escapeHtml.js';
import {
  FLOOR_PLAN_HEIGHT,
  FLOOR_PLAN_WIDTH,
  GRID_CELL,
  TABLE_SIZE_PRESETS,
  withTableDimensions,
} from '../tableSizes.js';

const STATUS_LABELS = {
  free: 'Свободен',
  occupied: 'Занят',
  dirty: 'Грязный',
};

function sizeSelectHtml(selectedSize) {
  return Object.entries(TABLE_SIZE_PRESETS)
    .map(([value, preset]) => {
      const isSelected = value === selectedSize ? ' selected' : '';
      return `<option value="${value}"${isSelected}>${preset.label}</option>`;
    })
    .join('');
}

export function renderZoneRow(zone, { oob = false, index = 0, total = 1 } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="beforeend:#zones-list"' : '';
  const safeName = escapeHtml(zone.name);
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  return `
    <div class="list-row" id="zone-row-${zone.id}"${oobAttr}>
      <div class="zone-row-main">
        <div class="zone-order-btns">
          <button
            type="button"
            class="zone-order-btn"
            title="Выше"
            ${atStart ? 'disabled' : ''}
            hx-post="/tables/zones/${zone.id}/move"
            hx-vals='{"dir":"up"}'
            hx-target="#zones-list"
            hx-swap="innerHTML"
          >↑</button>
          <button
            type="button"
            class="zone-order-btn"
            title="Ниже"
            ${atEnd ? 'disabled' : ''}
            hx-post="/tables/zones/${zone.id}/move"
            hx-vals='{"dir":"down"}'
            hx-target="#zones-list"
            hx-swap="innerHTML"
          >↓</button>
        </div>
        <button
          class="list-row-name zone-select-btn"
          hx-get="/tables/zones/${zone.id}/floor-plan"
          hx-target="#floor-plan-container"
          hx-swap="innerHTML"
        >${safeName}</button>
      </div>
      <button
        class="danger"
        hx-delete="/tables/zones/${zone.id}"
        hx-target="#zone-row-${zone.id}"
        hx-swap="outerHTML"
        hx-confirm="Удалить зону «${safeName}»? Все столы в ней тоже удалятся."
      >Удалить</button>
    </div>
  `;
}

export function renderZonesList(zones) {
  return zones
    .map((z, index) => renderZoneRow(z, { index, total: zones.length }))
    .join('');
}

/**
 * Плитка стола на схеме зала. Перетаскивание с привязкой к сетке.
 */
export function renderTableTile(table, { oob = false, zoneId = null } = {}) {
  const t = withTableDimensions(table);
  const oobAttr = oob && zoneId ? ` hx-swap-oob="beforeend:#floor-plan-${zoneId}"` : '';
  const safeName = escapeHtml(t.name);
  const cell = GRID_CELL;
  const maxX = FLOOR_PLAN_WIDTH - t.width;
  const maxY = FLOOR_PLAN_HEIGHT - t.height;

  return `
    <div
      class="table-tile status-${t.status} size-${t.size}"
      id="table-tile-${t.id}"
      style="left:${t.pos_x}px; top:${t.pos_y}px; width:${t.width}px; height:${t.height}px;"
      x-data="{ dragging:false, sx:0, sy:0, ox:${t.pos_x}, oy:${t.pos_y}, cell:${cell}, maxX:${maxX}, maxY:${maxY}, snap(v){ return Math.max(0, Math.round(v/this.cell)*this.cell); } }"
      @mousedown="dragging=true; sx=$event.clientX; sy=$event.clientY; ox=parseInt($el.style.left); oy=parseInt($el.style.top);"
      @mousemove.window="if(dragging){ const nx=Math.min(maxX, snap(ox + ($event.clientX - sx))); const ny=Math.min(maxY, snap(oy + ($event.clientY - sy))); $el.style.left = nx + 'px'; $el.style.top = ny + 'px'; }"
      @mouseup.window="if(dragging){ dragging=false; htmx.ajax('PUT', '/tables/${t.id}/position', { values: { pos_x: parseInt($el.style.left), pos_y: parseInt($el.style.top) }, swap: 'none' }); }"
      ${oobAttr}
    >
      <button
        class="table-edit-btn"
        @mousedown.stop
        hx-get="/tables/${t.id}/edit"
        hx-target="#table-tile-${t.id}"
        hx-swap="outerHTML"
        aria-label="Изменить стол"
      >✎</button>
      <div class="table-name">${safeName}</div>
      <div class="table-capacity">${t.capacity} мест</div>
    </div>
  `;
}

export function renderTableEditTile(table, errorMsg = null) {
  const t = withTableDimensions(table);
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([value, label]) => {
      const isSelected = value === t.status ? ' selected' : '';
      return `<option value="${value}"${isSelected}>${label}</option>`;
    })
    .join('');

  return `
    <form class="table-edit-panel" id="table-tile-${t.id}" style="left:${t.pos_x}px; top:${t.pos_y}px;">
      <input type="text" name="name" value="${escapeHtml(t.name)}" placeholder="Название" required>
      <input type="number" min="1" name="capacity" value="${t.capacity}" placeholder="Вместимость">
      <select name="size" title="Размер на сетке">${sizeSelectHtml(t.size)}</select>
      <select name="status">${statusOptions}</select>
      ${errorHtml}
      <div class="edit-actions">
        <button type="button" class="primary" hx-put="/tables/${t.id}" hx-target="#table-tile-${t.id}" hx-swap="outerHTML">Сохранить</button>
        <button type="button" hx-get="/tables/${t.id}/view" hx-target="#table-tile-${t.id}" hx-swap="outerHTML">Отмена</button>
      </div>
      <button type="button" class="danger" hx-delete="/tables/${t.id}" hx-target="#table-tile-${t.id}" hx-swap="outerHTML" hx-confirm="Удалить стол «${escapeHtml(t.name)}»?">Удалить</button>
    </form>
  `;
}

export function renderBlockTile(block, { oob = false, zoneId = null } = {}) {
  const oobAttr = oob && zoneId ? ` hx-swap-oob="beforeend:#floor-plan-${zoneId}"` : '';
  const safeName = escapeHtml(block.name || 'Прямоугольник');
  const cell = GRID_CELL;
  const maxX = FLOOR_PLAN_WIDTH - block.width;
  const maxY = FLOOR_PLAN_HEIGHT - block.height;
  const seatsLabel = block.seats > 0 ? `${block.seats} мест` : 'без мест';

  return `
    <div
      class="table-tile floor-block"
      id="block-tile-${block.id}"
      style="left:${block.pos_x}px; top:${block.pos_y}px; width:${block.width}px; height:${block.height}px; border-style:dashed; border-color:#e6c27a; background:rgba(230,194,122,0.12);"
      x-data="{ dragging:false, sx:0, sy:0, ox:${block.pos_x}, oy:${block.pos_y}, cell:${cell}, maxX:${maxX}, maxY:${maxY}, snap(v){ return Math.max(0, Math.round(v/this.cell)*this.cell); } }"
      @mousedown="dragging=true; sx=$event.clientX; sy=$event.clientY; ox=parseInt($el.style.left); oy=parseInt($el.style.top);"
      @mousemove.window="if(dragging){ const nx=Math.min(maxX, snap(ox + ($event.clientX - sx))); const ny=Math.min(maxY, snap(oy + ($event.clientY - sy))); $el.style.left = nx + 'px'; $el.style.top = ny + 'px'; }"
      @mouseup.window="if(dragging){ dragging=false; htmx.ajax('PUT', '/tables/blocks/${block.id}/position', { values: { pos_x: parseInt($el.style.left), pos_y: parseInt($el.style.top) }, swap: 'none' }); }"
      ${oobAttr}
    >
      <button
        class="table-edit-btn"
        @mousedown.stop
        hx-get="/tables/blocks/${block.id}/edit"
        hx-target="#block-tile-${block.id}"
        hx-swap="outerHTML"
        aria-label="Изменить прямоугольник"
      >✎</button>
      <div class="table-name">${safeName}</div>
      <div class="table-capacity">${seatsLabel}</div>
    </div>
  `;
}

export function renderBlockEditTile(block, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';
  const cols = Math.round(block.width / GRID_CELL);
  const rows = Math.round(block.height / GRID_CELL);
  return `
    <form class="table-edit-panel" id="block-tile-${block.id}" style="left:${block.pos_x}px; top:${block.pos_y}px; width:200px;">
      <input type="text" name="name" value="${escapeHtml(block.name || '')}" placeholder="Название" maxlength="50">
      <input type="number" min="0" max="99" name="seats" value="${Number(block.seats) || 0}" placeholder="Мест">
      <input type="number" min="1" max="16" name="cols" value="${cols}" title="Клеток в ширину">
      <input type="number" min="1" max="10" name="rows" value="${rows}" title="Клеток в высоту">
      ${errorHtml}
      <div class="edit-actions">
        <button type="button" class="primary" hx-put="/tables/blocks/${block.id}" hx-target="#block-tile-${block.id}" hx-swap="outerHTML">Сохранить</button>
        <button type="button" hx-get="/tables/blocks/${block.id}/view" hx-target="#block-tile-${block.id}" hx-swap="outerHTML">Отмена</button>
      </div>
      <button type="button" class="danger" hx-delete="/tables/blocks/${block.id}" hx-target="#block-tile-${block.id}" hx-swap="outerHTML" hx-confirm="Убрать прямоугольник?">Удалить</button>
    </form>
  `;
}

export function renderFloorPlan(zone, tableList, blockList = []) {
  if (!zone) {
    return '<p class="empty-hint">Сначала добавь зону выше.</p>';
  }

  const tiles = tableList.map((t) => renderTableTile(t)).join('');
  const blocks = (blockList || []).map((block) => renderBlockTile(block)).join('');

  return `
    <form
      class="section-form"
      hx-post="/tables/zones/${zone.id}/tables"
      hx-target="#table-form-error"
      hx-swap="innerHTML"
      hx-on::after-request="if(event.detail.successful) this.reset()"
    >
      <input type="text" name="name" placeholder="Название стола" required>
      <input type="number" min="1" name="capacity" placeholder="Вместимость" value="4">
      <select name="size" title="Размер на сетке">${sizeSelectHtml('medium')}</select>
      <button type="submit">Добавить стол</button>
      <div id="table-form-error" class="error"></div>
    </form>
    <form
      class="section-form"
      hx-post="/tables/zones/${zone.id}/blocks"
      hx-target="#block-form-error"
      hx-swap="innerHTML"
      hx-on::after-request="if(event.detail.successful) this.reset()"
    >
      <input type="text" name="name" placeholder="Прямоугольник, например диван" maxlength="50">
      <input type="number" min="0" max="99" name="seats" value="0" title="Мест. Бронь недоступна">
      <input type="number" min="1" max="16" name="cols" value="4" title="Клеток в ширину">
      <input type="number" min="1" max="10" name="rows" value="2" title="Клеток в высоту">
      <button type="submit">Добавить прямоугольник</button>
      <div id="block-form-error" class="error"></div>
    </form>
    <p class="hint">Сетка ${GRID_CELL}×${GRID_CELL}px (${FLOOR_PLAN_WIDTH}×${FLOOR_PLAN_HEIGHT}). Столы двигаются только по клеткам — та же схема на терминале без масштабирования. Пунктир нельзя забронировать, места у него можно указать: для Розы он сам появляется на сайте брони и на терминал не попадает.</p>
    <div
      class="floor-plan floor-plan-grid"
      id="floor-plan-${zone.id}"
      style="width:${FLOOR_PLAN_WIDTH}px; height:${FLOOR_PLAN_HEIGHT}px; --grid-cell:${GRID_CELL}px;"
    >${tiles}${blocks}</div>
  `;
}

/** Зоны + схема зала для конкретного заведения — то, что перерисовывается при смене заведения */
export function renderVenueZonesAndFloorPlan(venueId, zones, selectedZone, tableList, blockList = null) {
  const load = blockList == null && selectedZone
    ? ` hx-get="/tables/zones/${selectedZone.id}/floor-plan" hx-trigger="load" hx-swap="innerHTML"`
    : '';
  return `
    <div class="subsection">
      <h2>Зоны</h2>
      <p class="hint">Порядок зон (стрелки ↑↓) — тот же, что в терминале при переключении.</p>
      <div class="list" id="zones-list">${renderZonesList(zones)}</div>
      <form
        class="section-form section-form-compact"
        hx-post="/tables/venues/${venueId}/zones"
        hx-target="#zones-list"
        hx-swap="innerHTML"
        hx-on::after-request="if(event.detail.successful) this.reset()"
      >
        <input type="text" name="name" placeholder="Новая зона" required>
        <button type="submit">Добавить зону</button>
      </form>
      <div id="zone-form-error" class="error"></div>
    </div>

    <div class="subsection">
      <h2>Схема зала</h2>
      <div id="floor-plan-container"${load}>${renderFloorPlan(selectedZone, tableList, blockList || [])}</div>
    </div>
  `;
}

export function renderTablesSection(venues, selectedVenueId, zones, selectedZone, tableList) {
  if (venues.length === 0) {
    return `
      <header>
        <h1>Столы</h1>
        <p>Расстановка столов по залу</p>
      </header>
      <p class="empty-hint">Сначала добавь заведение в разделе «Заведения» — у каждого свои зоны и столы.</p>
    `;
  }

  const selectedVenue = venues.find((v) => String(v.id) === String(selectedVenueId));

  return `
    <header>
      <h1>Столы</h1>
      <p>Расстановка столов по залу${selectedVenue ? ` — ${escapeHtml(selectedVenue.name)}` : ''}. Заведение переключается в шапке слева.</p>
    </header>

    <div id="tables-venue-container">
      ${renderVenueZonesAndFloorPlan(selectedVenueId, zones, selectedZone, tableList)}
    </div>
  `;
}

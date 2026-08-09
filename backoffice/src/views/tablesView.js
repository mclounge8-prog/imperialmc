import { escapeHtml } from './escapeHtml.js';

const STATUS_LABELS = {
  free: 'Свободен',
  occupied: 'Занят',
  dirty: 'Грязный',
};

export function renderZoneRow(zone, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="beforeend:#zones-list"' : '';
  const safeName = escapeHtml(zone.name);

  return `
    <div class="list-row" id="zone-row-${zone.id}"${oobAttr}>
      <button
        class="list-row-name zone-select-btn"
        hx-get="/tables/zones/${zone.id}/floor-plan"
        hx-target="#floor-plan-container"
        hx-swap="innerHTML"
      >${safeName}</button>
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

/**
 * Плитка стола на схеме зала. Перетаскивание — Alpine (локальное состояние + мышь),
 * сохранение позиции — htmx.ajax вызывается прямо из обработчика mouseup,
 * потому что координаты динамические и их нельзя зашить в статичный hx-vals.
 */
export function renderTableTile(table, { oob = false, zoneId = null } = {}) {
  const oobAttr = oob && zoneId ? ` hx-swap-oob="beforeend:#floor-plan-${zoneId}"` : '';
  const safeName = escapeHtml(table.name);

  return `
    <div
      class="table-tile status-${table.status}"
      id="table-tile-${table.id}"
      style="left:${table.pos_x}px; top:${table.pos_y}px;"
      x-data="{ dragging:false, sx:0, sy:0, ox:${table.pos_x}, oy:${table.pos_y} }"
      @mousedown="dragging=true; sx=$event.clientX; sy=$event.clientY; ox=parseInt($el.style.left); oy=parseInt($el.style.top);"
      @mousemove.window="if(dragging){ $el.style.left = Math.max(0, ox + ($event.clientX - sx)) + 'px'; $el.style.top = Math.max(0, oy + ($event.clientY - sy)) + 'px'; }"
      @mouseup.window="if(dragging){ dragging=false; htmx.ajax('PUT', '/tables/${table.id}/position', { values: { pos_x: parseInt($el.style.left), pos_y: parseInt($el.style.top) }, swap: 'none' }); }"
      ${oobAttr}
    >
      <button
        class="table-edit-btn"
        @mousedown.stop
        hx-get="/tables/${table.id}/edit"
        hx-target="#table-tile-${table.id}"
        hx-swap="outerHTML"
        aria-label="Изменить стол"
      >✎</button>
      <div class="table-name">${safeName}</div>
      <div class="table-capacity">${table.capacity} мест</div>
    </div>
  `;
}

export function renderTableEditTile(table, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([value, label]) => {
      const isSelected = value === table.status ? ' selected' : '';
      return `<option value="${value}"${isSelected}>${label}</option>`;
    })
    .join('');

  return `
    <form class="table-edit-panel" id="table-tile-${table.id}" style="left:${table.pos_x}px; top:${table.pos_y}px;">
      <input type="text" name="name" value="${escapeHtml(table.name)}" placeholder="Название" required>
      <input type="number" min="1" name="capacity" value="${table.capacity}" placeholder="Вместимость">
      <select name="status">${statusOptions}</select>
      ${errorHtml}
      <div class="edit-actions">
        <button type="button" class="primary" hx-put="/tables/${table.id}" hx-target="#table-tile-${table.id}" hx-swap="outerHTML">Сохранить</button>
        <button type="button" hx-get="/tables/${table.id}/view" hx-target="#table-tile-${table.id}" hx-swap="outerHTML">Отмена</button>
      </div>
      <button type="button" class="danger" hx-delete="/tables/${table.id}" hx-target="#table-tile-${table.id}" hx-swap="outerHTML" hx-confirm="Удалить стол «${escapeHtml(table.name)}»?">Удалить</button>
    </form>
  `;
}

export function renderFloorPlan(zone, tableList) {
  if (!zone) {
    return '<p class="empty-hint">Сначала добавь зону выше.</p>';
  }

  const tiles = tableList.map((t) => renderTableTile(t)).join('');

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
      <button type="submit">Добавить стол</button>
      <div id="table-form-error" class="error"></div>
    </form>
    <p class="hint">Перетаскивай столы мышью, чтобы расставить их по залу «${escapeHtml(zone.name)}».</p>
    <div class="floor-plan" id="floor-plan-${zone.id}">${tiles}</div>
  `;
}

/** Зоны + схема зала для конкретного заведения — то, что перерисовывается при смене заведения */
export function renderVenueZonesAndFloorPlan(venueId, zones, selectedZone, tableList) {
  const zoneRows = zones.map((z) => renderZoneRow(z)).join('');

  return `
    <div class="subsection">
      <h2>Зоны</h2>
      <div class="list" id="zones-list">${zoneRows}</div>
      <form
        class="section-form section-form-compact"
        hx-post="/tables/venues/${venueId}/zones"
        hx-target="#zone-form-error"
        hx-swap="innerHTML"
        hx-on::after-request="if(event.detail.successful) this.reset()"
      >
        <input type="text" name="name" placeholder="Новая зона" required>
        <button type="submit">Добавить зону</button>
        <div id="zone-form-error" class="error"></div>
      </form>
    </div>

    <div class="subsection">
      <h2>Схема зала</h2>
      <div id="floor-plan-container">${renderFloorPlan(selectedZone, tableList)}</div>
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

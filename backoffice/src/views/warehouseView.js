import { escapeHtml } from './escapeHtml.js';

export const UNITS = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

function unitOptions(selected) {
  return Object.entries(UNITS)
    .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function categorySelectOptions(categories, selectedId) {
  const options = categories
    .map((cat) => {
      const isSelected = String(cat.id) === String(selectedId) ? ' selected' : '';
      return `<option value="${cat.id}"${isSelected}>${escapeHtml(cat.name)}</option>`;
    })
    .join('');
  return `<option value="">Без категории</option>${options}`;
}

/**
 * Select категории в модалке «+ Позиция» — стабильный id, чтобы после
 * создания новой категории можно было обновить его OOB-вставкой. Без этого
 * новую категорию нельзя было выбрать для позиции без обновления страницы.
 */
export function renderItemCategorySelect(categories, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="true"' : '';
  return `<select name="category_id" id="warehouse-item-category-select"${oobAttr}>${categorySelectOptions(categories, null)}</select>`;
}

/* ---------- Строка остатка (для выбранного заведения) ---------- */

export function renderStockRow(venueId, item, { oob = false, targetId = null } = {}) {
  const oobAttr = oob && targetId ? ` hx-swap-oob="beforeend:#${targetId}"` : '';
  const stockQty = Number(item.stock_qty);
  const minStockQty = Number(item.min_stock_qty);
  const isLow = stockQty <= minStockQty;
  const badgeClass = isLow ? 'badge-warning' : 'badge-ok';
  const badgeLabel = isLow ? 'Мало' : 'ОК';
  const safeName = escapeHtml(item.name);

  return `
    <tr id="item-row-${item.id}"${oobAttr}>
      <td>${safeName}</td>
      <td>${UNITS[item.unit] || item.unit}</td>
      <td class="stock-cell">
        <input
          type="number" step="0.001" min="0" name="stock_qty" value="${stockQty}"
          hx-put="/warehouse/venues/${venueId}/items/${item.id}/stock"
          hx-trigger="change" hx-include="closest tr"
          hx-target="#item-row-${item.id}" hx-swap="outerHTML"
        >
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </td>
      <td>
        <input
          type="number" step="0.001" min="0" name="min_stock_qty" value="${minStockQty}"
          hx-put="/warehouse/venues/${venueId}/items/${item.id}/stock"
          hx-trigger="change" hx-include="closest tr"
          hx-target="#item-row-${item.id}" hx-swap="outerHTML"
        >
      </td>
      <td class="row-actions">
        <button hx-get="/warehouse/items/${item.id}/edit?venueId=${venueId}" hx-target="#item-row-${item.id}" hx-swap="outerHTML">Каталог</button>
        <button
          class="danger"
          hx-delete="/warehouse/items/${item.id}"
          hx-target="#item-row-${item.id}"
          hx-swap="outerHTML"
          hx-confirm="Удалить «${safeName}» из каталога совсем? Уберётся из всех заведений."
        >Удалить</button>
      </td>
    </tr>
  `;
}

export function renderCatalogEditRow(item, categories, venueId, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  return `
    <tr id="item-row-${item.id}">
      <td><input type="text" name="name" value="${escapeHtml(item.name)}" required></td>
      <td colspan="2">
        <select name="category_id">${categorySelectOptions(categories, item.category_id)}</select>
        <select name="unit">${unitOptions(item.unit)}</select>
        <input type="hidden" name="venue_id" value="${venueId}">
      </td>
      <td>${errorHtml}</td>
      <td class="row-actions">
        <button hx-put="/warehouse/items/${item.id}" hx-include="closest tr" hx-target="#item-row-${item.id}" hx-swap="outerHTML">Сохранить</button>
        <button hx-get="/warehouse/venues/${venueId}/items/${item.id}/view" hx-target="#item-row-${item.id}" hx-swap="outerHTML">Отмена</button>
      </td>
    </tr>
  `;
}

/* ---------- Аккордеон: категория = спойлер, внутри — таблица остатков ---------- */

function renderAccordionTable(bodyId, rowsHtml) {
  return `
    <table class="data-table">
      <thead>
        <tr><th>Наименование</th><th>Ед.</th><th>Остаток</th><th>Мин.</th><th>Действия</th></tr>
      </thead>
      <tbody id="${bodyId}">${rowsHtml}</tbody>
    </table>
  `;
}

export function renderCategoryAccordionSection(
  venueId,
  category,
  items,
  { oob = false, oobMode = 'append', forceOpen = false } = {}
) {
  // 'append' — новая категория, вставляется в конец аккордеона (редкое
  // действие, порядок подправится при следующей полной загрузке раздела).
  // 'replace' — категория уже существует на экране (просто добавили в неё
  // позицию) — целиком заменяем ЕЁ секцию по id, не трогая остальные
  // (соседние аккордеоны не сворачиваются/не теряют состояние Alpine).
  const oobAttr = oob
    ? oobMode === 'replace'
      ? ' hx-swap-oob="true"'
      : ' hx-swap-oob="beforeend:#stock-accordion"'
    : '';
  // По умолчанию свёрнуты — при 20+ категориях полностью развёрнутый список
  // остатков превращается в нечитаемую стену таблиц. Открываем только то, что
  // только что создали/куда только что что-то добавили (forceOpen) — так
  // результат действия сразу видно, а всё остальное не мешает.
  const initialOpen = forceOpen ? 'true' : 'false';
  const safeName = escapeHtml(category.name);
  const bodyId = `category-items-${category.id}`;
  const rows = items.map((i) => renderStockRow(venueId, i)).join('');

  return `
    <div class="accordion-section" id="category-section-${category.id}"${oobAttr} x-data="{ open: ${initialOpen} }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">${safeName}</span>
        <span class="accordion-count">${items.length}</span>
        <button
          type="button"
          class="btn-danger"
          @click.stop
          hx-delete="/warehouse/categories/${category.id}?venueId=${venueId}"
          hx-target="#category-section-${category.id}"
          hx-swap="outerHTML"
          hx-confirm="Удалить категорию «${safeName}»?"
        >Удалить</button>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderAccordionTable(bodyId, rows)}
      </div>
    </div>
  `;
}

export function renderUncategorizedAccordionSection(venueId, items, { oob = false, forceOpen = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="true"' : '';
  const initialOpen = forceOpen ? 'true' : 'false';
  const rows = items.map((i) => renderStockRow(venueId, i)).join('');
  return `
    <div class="accordion-section" id="uncategorized-section"${oobAttr} x-data="{ open: ${initialOpen} }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">Без категории</span>
        <span class="accordion-count">${items.length}</span>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderAccordionTable('uncategorized-items', rows)}
      </div>
    </div>
  `;
}

export function renderStockAccordion(venueId, categories, items) {
  const categorySections = categories
    .map((cat) => renderCategoryAccordionSection(venueId, cat, items.filter((i) => i.category_id === cat.id)))
    .join('');
  const uncategorizedSection = renderUncategorizedAccordionSection(
    venueId,
    items.filter((i) => !i.category_id)
  );

  return `<div id="stock-accordion">${categorySections}${uncategorizedSection}</div>`;
}

/* ---------- Модалки добавления (Alpine — открытие/закрытие без сервера) ---------- */

function renderAddCategoryModal(venueId) {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Категория</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новая категория</h3>
          <form
            hx-post="/warehouse/categories"
            hx-target="#category-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Название" required>
            <input type="hidden" name="venue_id" value="${venueId}">
            <div id="category-form-error" class="error"></div>
            <div class="modal-actions">
              <button type="submit" class="btn-primary">Добавить</button>
              <button type="button" class="btn-secondary" @click="open = false">Отмена</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderAddItemModal(venueId, categories) {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Позиция</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новая позиция каталога</h3>
          <form
            hx-post="/warehouse/items"
            hx-target="#item-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Наименование" required>
            ${renderItemCategorySelect(categories)}
            <select name="unit" required>
              <option value="g">г</option>
              <option value="ml">мл</option>
              <option value="pcs">шт</option>
            </select>
            <input type="hidden" name="venue_id" value="${venueId}">
            <div id="item-form-error" class="error"></div>
            <div class="modal-actions">
              <button type="submit" class="btn-primary">Добавить</button>
              <button type="button" class="btn-secondary" @click="open = false">Отмена</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

/* ---------- Верхний уровень раздела ---------- */

export function renderWarehouseSection(venues, selectedVenueId, categories, items) {
  if (venues.length === 0) {
    return `
      <header>
        <h1>Склад</h1>
        <p>Номенклатура сырья и остатки</p>
      </header>
      <p class="empty-hint">Сначала добавь заведение в разделе «Заведения» — у каждого свой склад.</p>
    `;
  }

  const selectedVenue = venues.find((v) => String(v.id) === String(selectedVenueId));

  return `
    <header>
      <h1>Склад</h1>
      <p>Номенклатура сырья и остатки по заведению${selectedVenue ? ` — ${escapeHtml(selectedVenue.name)}` : ''}. Заведение переключается в шапке слева.</p>
    </header>

    <div class="subsection">
      <div class="subsection-header">
        <h2>Категории и остатки</h2>
        <div class="subsection-actions">
          ${renderAddCategoryModal(selectedVenueId)}
          ${renderAddItemModal(selectedVenueId, categories)}
        </div>
      </div>
      <p class="hint">
        Каталог (названия, категории, единицы измерения) один общий на все заведения.
        Меняется по заведениям только количество — колонки «Остаток» и «Мин.» ниже
        относятся именно к выбранному в шапке заведению.
      </p>
      <input
        type="search"
        class="search-input"
        placeholder="Поиск по названию…"
        oninput="filterCatalogSearch(this, 'stock-container')"
      >
      <div id="stock-container">${renderStockAccordion(selectedVenueId, categories, items)}</div>
    </div>
  `;
}

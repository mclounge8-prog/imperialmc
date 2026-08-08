import { escapeHtml } from './escapeHtml.js';
import { UNITS } from './warehouseView.js';

function categoryOptions(categories, selectedId) {
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
 * создания новой категории обновить его OOB-вставкой (иначе новую категорию
 * нельзя выбрать для позиции без обновления страницы).
 */
export function renderMenuItemCategorySelect(categories, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="true"' : '';
  return `<select name="category_id" id="menu-item-category-select"${oobAttr}>${categoryOptions(categories, null)}</select>`;
}

/* ---------- Строка позиции меню ---------- */

export function renderMenuItemRow(item, { oob = false, targetId = null } = {}) {
  const oobAttr = oob && targetId ? ` hx-swap-oob="beforeend:#${targetId}"` : '';
  const statusClass = item.is_active ? 'badge-active' : 'badge-inactive';
  const statusLabel = item.is_active ? 'Активна' : 'Отключена';
  const toggleLabel = item.is_active ? 'Отключить' : 'Включить';
  const safeName = escapeHtml(item.name);
  const price = Number(item.price).toFixed(2);
  const recipeCount = Number(item.recipe_count || 0);
  const thumb = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" class="item-thumb" alt="">`
    : `<span class="item-thumb item-thumb-empty">—</span>`;

  return `
    <tr id="menu-row-${item.id}"${oobAttr}>
      <td>
        <div class="item-name-cell">
          ${thumb}
          <label class="upload-label" title="Загрузить фото">
            📷
            <input
              type="file" accept="image/*" name="image" style="display:none"
              hx-post="/menu/items/${item.id}/image"
              hx-encoding="multipart/form-data"
              hx-trigger="change"
              hx-target="#menu-row-${item.id}"
              hx-swap="outerHTML"
            >
          </label>
          <span>${safeName}</span>
        </div>
      </td>
      <td>${price} ₽</td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td class="row-actions">
        <button hx-get="/menu/items/${item.id}/edit" hx-target="#menu-row-${item.id}" hx-swap="outerHTML">Изменить</button>
        <button hx-get="/menu/items/${item.id}/recipe" hx-target="#main-content" hx-push-url="/dashboard#menu">Рецептура (${recipeCount})</button>
        <button hx-post="/menu/items/${item.id}/toggle" hx-target="#menu-row-${item.id}" hx-swap="outerHTML">${toggleLabel}</button>
        <button class="danger" hx-delete="/menu/items/${item.id}" hx-target="#menu-row-${item.id}" hx-swap="outerHTML" hx-confirm="Удалить «${safeName}» из меню?">Удалить</button>
      </td>
    </tr>
  `;
}

export function renderMenuItemEditRow(item, categories, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  return `
    <tr id="menu-row-${item.id}">
      <td><input type="text" name="name" value="${escapeHtml(item.name)}" required></td>
      <td><input type="number" step="0.01" min="0" name="price" value="${Number(item.price)}"></td>
      <td><select name="category_id">${categoryOptions(categories, item.category_id)}</select></td>
      <td class="row-actions">
        ${errorHtml}
        <button hx-put="/menu/items/${item.id}" hx-include="closest tr" hx-target="#menu-row-${item.id}" hx-swap="outerHTML">Сохранить</button>
        <button hx-get="/menu/items/${item.id}/view" hx-target="#menu-row-${item.id}" hx-swap="outerHTML">Отмена</button>
      </td>
    </tr>
  `;
}

/* ---------- Аккордеон: категория меню = спойлер ---------- */

function renderMenuAccordionTable(bodyId, rowsHtml) {
  return `
    <table class="data-table">
      <thead>
        <tr><th>Наименование</th><th>Цена</th><th>Статус</th><th>Действия</th></tr>
      </thead>
      <tbody id="${bodyId}">${rowsHtml}</tbody>
    </table>
  `;
}

export function renderMenuCategoryAccordionSection(
  category,
  items,
  venueId,
  isHidden,
  { oob = false, oobMode = 'append', forceOpen = false } = {}
) {
  // 'append' — новая категория, в конец аккордеона (редкое действие).
  // 'replace' — категория уже на экране, целиком заменяем ЕЁ секцию по id
  // (например, после добавления в неё позиции) — соседние секции не трогаем.
  const oobAttr = oob
    ? oobMode === 'replace'
      ? ' hx-swap-oob="true"'
      : ' hx-swap-oob="beforeend:#menu-accordion"'
    : '';
  const initialOpen = forceOpen ? 'true' : 'false';
  const safeName = escapeHtml(category.name);
  const iconPrefix = category.icon ? `${escapeHtml(category.icon)} ` : '';
  const bodyId = `menu-category-items-${category.id}`;
  const rows = items.map((i) => renderMenuItemRow(i)).join('');

  const visibilityToggle = `
    <label class="visibility-toggle" @click.stop title="Видимость этой категории именно в выбранном заведении">
      <input
        type="checkbox"
        ${isHidden ? '' : 'checked'}
        hx-post="/menu/venues/${venueId}/categories/${category.id}/toggle-visibility"
        hx-target="#menu-category-section-${category.id}"
        hx-swap="outerHTML"
      >
      Показывать здесь
    </label>
  `;

  return `
    <div class="accordion-section" id="menu-category-section-${category.id}"${oobAttr} x-data="{ open: ${initialOpen} }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">${iconPrefix}${safeName}</span>
        <span class="accordion-count">${items.length}</span>
        ${visibilityToggle}
        <button
          type="button"
          class="btn-danger"
          @click.stop
          hx-delete="/menu/categories/${category.id}?venueId=${venueId}"
          hx-target="#menu-category-section-${category.id}"
          hx-swap="outerHTML"
          hx-confirm="Удалить категорию «${safeName}»?"
        >Удалить</button>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderMenuAccordionTable(bodyId, rows)}
      </div>
    </div>
  `;
}

export function renderMenuUncategorizedAccordionSection(items, { oob = false, forceOpen = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="true"' : '';
  const initialOpen = forceOpen ? 'true' : 'false';
  const rows = items.map((i) => renderMenuItemRow(i)).join('');
  return `
    <div class="accordion-section" id="menu-uncategorized-section"${oobAttr} x-data="{ open: ${initialOpen} }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">Без категории</span>
        <span class="accordion-count">${items.length}</span>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderMenuAccordionTable('menu-uncategorized-items', rows)}
      </div>
    </div>
  `;
}

export function renderMenuAccordion(venueId, categories, hiddenCategoryIds, items) {
  const sections = categories
    .map((cat) =>
      renderMenuCategoryAccordionSection(
        cat,
        items.filter((i) => i.category_id === cat.id),
        venueId,
        hiddenCategoryIds.includes(cat.id)
      )
    )
    .join('');
  const uncategorizedSection = renderMenuUncategorizedAccordionSection(
    items.filter((i) => !i.category_id)
  );
  return `<div id="menu-accordion">${sections}${uncategorizedSection}</div>`;
}

/* ---------- Модалки добавления ---------- */

function renderAddMenuCategoryModal(venueId) {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Категория</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новая категория меню</h3>
          <form
            hx-post="/menu/categories"
            hx-target="#menu-category-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Название" required>
            <input type="text" name="icon" placeholder="Эмодзи-иконка, напр. 🍃" maxlength="8">
            <input type="hidden" name="venue_id" value="${venueId}">
            <div id="menu-category-form-error" class="error"></div>
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

function renderAddMenuItemModal(categories, venueId) {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Позиция</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новая позиция меню</h3>
          <form
            hx-post="/menu/items"
            hx-target="#menu-item-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Наименование" required>
            ${renderMenuItemCategorySelect(categories)}
            <input type="number" step="0.01" min="0" name="price" placeholder="Цена" required>
            <input type="hidden" name="venue_id" value="${venueId}">
            <div id="menu-item-form-error" class="error"></div>
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

export function renderMenuVenueContainer(venueId, categories, hiddenCategoryIds, items) {
  return `
    <div class="subsection">
      <div class="subsection-header">
        <h2>Категории и позиции</h2>
        <div class="subsection-actions">
          ${renderAddMenuCategoryModal(venueId)}
          ${renderAddMenuItemModal(categories, venueId)}
        </div>
      </div>
      <p class="hint">
        Сами позиции и категории общие для всех заведений. Галочка «Показывать здесь»
        у каждой категории — это видимость именно для выбранного выше заведения:
        выключишь — гости этой точки не увидят категорию на терминале, а на других
        точках она останется как была.
      </p>
      ${renderMenuAccordion(venueId, categories, hiddenCategoryIds, items)}
    </div>
  `;
}

export function renderMenuSection(venues, selectedVenueId, categories, hiddenCategoryIds, items) {
  if (venues.length === 0) {
    return `
      <header>
        <h1>Меню</h1>
        <p>Позиции меню и категории</p>
      </header>
      <p class="empty-hint">Сначала добавь заведение в разделе «Заведения» — видимость категорий настраивается по заведению.</p>
    `;
  }

  const venueOptions = venues
    .map((v) => `<option value="${v.id}"${String(v.id) === String(selectedVenueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`)
    .join('');

  return `
    <header>
      <h1>Меню</h1>
      <p>Позиции меню — общие, видимость категорий — по заведению</p>
    </header>

    <div class="subsection">
      <h2>Заведение</h2>
      <select
        class="venue-select"
        name="venueId"
        hx-get="/menu/venue-view"
        hx-trigger="change"
        hx-target="#menu-venue-container"
        hx-swap="innerHTML"
      >${venueOptions}</select>
    </div>

    <div id="menu-venue-container">
      ${renderMenuVenueContainer(selectedVenueId, categories, hiddenCategoryIds, items)}
    </div>
  `;
}

// ---------- Рецептура ----------

export function renderRecipeRow(recipe) {
  const safeName = escapeHtml(recipe.warehouse_item_name);
  const unitLabel = UNITS[recipe.unit] || recipe.unit;

  return `
    <tr id="recipe-row-${recipe.id}">
      <td>${safeName}</td>
      <td>${Number(recipe.qty)} ${unitLabel}</td>
      <td class="row-actions">
        <button class="danger" hx-delete="/menu/items/${recipe.menu_item_id}/recipe/${recipe.id}" hx-target="#recipe-row-${recipe.id}" hx-swap="outerHTML" hx-confirm="Убрать «${safeName}» из рецептуры?">Удалить</button>
      </td>
    </tr>
  `;
}

/**
 * Целиком таблица рецептуры с hx-swap-oob="true" — после добавления новой
 * позиции сервер отдаёт свежий список, отсортированный как при обычной
 * загрузке (по названию ингредиента), вместо вставки строки в конец.
 */
export function renderRecipeListOob(recipeRows) {
  const rows = recipeRows.map((r) => renderRecipeRow(r)).join('');
  return `<tbody id="recipe-list" hx-swap-oob="true">${rows}</tbody>`;
}

export function renderRecipeEditor(menuItem, recipeRows, warehouseItems) {
  const rows = recipeRows.map((r) => renderRecipeRow(r)).join('');
  const ingredientOptions = warehouseItems
    .map((wi) => `<option value="${wi.id}">${escapeHtml(wi.name)} (${UNITS[wi.unit] || wi.unit})</option>`)
    .join('');

  return `
    <header>
      <h1>Рецептура: ${escapeHtml(menuItem.name)}</h1>
      <p>Что списывается со склада при продаже одной позиции</p>
    </header>

    <button
      class="back-link"
      hx-get="/fragments/menu"
      hx-target="#main-content"
      hx-push-url="/dashboard#menu"
    >← Назад к меню</button>

    <form
      class="section-form"
      hx-post="/menu/items/${menuItem.id}/recipe"
      hx-target="#recipe-form-error"
      hx-swap="innerHTML"
      hx-on::after-request="if(event.detail.successful) this.reset()"
    >
      <select name="warehouse_item_id" required>
        <option value="">Ингредиент…</option>
        ${ingredientOptions}
      </select>
      <input type="number" step="0.001" min="0.001" name="qty" placeholder="Количество" required>
      <button type="submit">Добавить в рецептуру</button>
      <div id="recipe-form-error" class="error"></div>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>Ингредиент</th>
          <th>Количество</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody id="recipe-list">${rows}</tbody>
    </table>
  `;
}

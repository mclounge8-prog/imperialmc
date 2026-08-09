import { escapeHtml } from './escapeHtml.js';
import { UNITS } from './warehouseView.js';

function formatMoney(value) {
  return `${Number(value).toFixed(2)} ₽`;
}

function groupSelectOptions(groups, selectedId) {
  const options = groups
    .map((g) => {
      const isSelected = String(g.id) === String(selectedId) ? ' selected' : '';
      return `<option value="${g.id}"${isSelected}>${escapeHtml(g.name)}</option>`;
    })
    .join('');
  return `<option value="">Без группы (обычный ингредиент)</option>${options}`;
}

function warehouseItemSelectOptions(warehouseItems, selectedId) {
  const options = warehouseItems
    .map((wi) => {
      const isSelected = String(wi.id) === String(selectedId) ? ' selected' : '';
      return `<option value="${wi.id}"${isSelected}>${escapeHtml(wi.name)} (${UNITS[wi.unit] || wi.unit})</option>`;
    })
    .join('');
  return `<option value="">Не списывать со склада</option>${options}`;
}

/* ---------- Строка модификатора ---------- */

export function renderModifierRow(modifier) {
  const safeName = escapeHtml(modifier.name);
  const warehouseInfo = modifier.warehouse_item_name
    ? `${escapeHtml(modifier.warehouse_item_name)} · ${Number(modifier.qty)} ${UNITS[modifier.warehouse_item_unit] || modifier.warehouse_item_unit || ''}`
    : '—';

  return `
    <tr id="modifier-row-${modifier.id}">
      <td>${safeName}</td>
      <td>${formatMoney(modifier.price)}</td>
      <td>${warehouseInfo}</td>
      <td class="row-actions">
        <button hx-get="/modifiers/${modifier.id}/edit" hx-target="#modifier-row-${modifier.id}" hx-swap="outerHTML">Изменить</button>
        <button class="danger" hx-delete="/modifiers/${modifier.id}" hx-target="#modifier-row-${modifier.id}" hx-swap="outerHTML" hx-confirm="Удалить модификатор «${safeName}» совсем? Уберётся из всех позиций меню.">Удалить</button>
      </td>
    </tr>
  `;
}

export function renderModifierEditRow(modifier, groups, warehouseItems, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  return `
    <tr id="modifier-row-${modifier.id}">
      <td><input type="text" name="name" value="${escapeHtml(modifier.name)}" required></td>
      <td><input type="number" step="0.01" min="0" name="price" value="${Number(modifier.price)}" style="width:90px"></td>
      <td>
        <select name="warehouse_item_id">${warehouseItemSelectOptions(warehouseItems, modifier.warehouse_item_id)}</select>
        <input type="number" step="0.001" min="0" name="qty" value="${Number(modifier.qty || 0)}" placeholder="Кол-во" style="width:80px">
      </td>
      <td class="row-actions">
        ${errorHtml}
        <select name="group_id">${groupSelectOptions(groups, modifier.group_id)}</select>
        <button hx-put="/modifiers/${modifier.id}" hx-include="closest tr" hx-target="#modifier-row-${modifier.id}" hx-swap="outerHTML">Сохранить</button>
        <button hx-get="/modifiers/${modifier.id}/view" hx-target="#modifier-row-${modifier.id}" hx-swap="outerHTML">Отмена</button>
      </td>
    </tr>
  `;
}

/* ---------- Аккордеон: группа модификаторов = спойлер ---------- */

function renderModifierTable(bodyId, rowsHtml) {
  return `
    <table class="data-table">
      <thead>
        <tr><th>Название</th><th>Цена</th><th>Списание со склада</th><th>Действия</th></tr>
      </thead>
      <tbody id="${bodyId}">${rowsHtml}</tbody>
    </table>
  `;
}

export function renderGroupAccordionSection(group, modifiers, { oob = false, oobMode = 'append' } = {}) {
  const oobAttr = oob
    ? oobMode === 'replace'
      ? ' hx-swap-oob="true"'
      : ' hx-swap-oob="beforeend:#modifiers-accordion"'
    : '';
  const safeName = escapeHtml(group.name);
  const bodyId = `modifier-group-items-${group.id}`;
  const rows = modifiers.map((m) => renderModifierRow(m)).join('');
  const limitLabel =
    group.max_select != null
      ? `выбор: ${group.min_select > 0 ? `от ${group.min_select} ` : ''}до ${group.max_select}`
      : group.min_select > 0
        ? `выбор: минимум ${group.min_select}`
        : 'выбор не ограничен';

  return `
    <div class="accordion-section" id="modifier-group-section-${group.id}"${oobAttr} x-data="{ open: true }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">${safeName}</span>
        <span class="accordion-count">${modifiers.length}</span>
        <span class="hint" style="margin:0 8px 0 0">${limitLabel}</span>
        <button
          type="button"
          class="btn-danger"
          @click.stop
          hx-delete="/modifiers/groups/${group.id}"
          hx-target="#modifier-group-section-${group.id}"
          hx-swap="outerHTML"
          hx-confirm="Удалить группу «${safeName}»? Модификаторы внутри неё станут обычными ингредиентами без группы."
        >Удалить</button>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderModifierTable(bodyId, rows)}
      </div>
    </div>
  `;
}

export function renderUngroupedAccordionSection(modifiers, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="true"' : '';
  const rows = modifiers.map((m) => renderModifierRow(m)).join('');
  return `
    <div class="accordion-section" id="modifier-ungrouped-section"${oobAttr} x-data="{ open: true }">
      <div class="accordion-header" role="button" tabindex="0" @click="open = !open">
        <span class="accordion-arrow" :class="{ 'accordion-arrow-open': open }">▸</span>
        <span class="accordion-title">Обычные ингредиенты (без группы)</span>
        <span class="accordion-count">${modifiers.length}</span>
      </div>
      <div class="accordion-body" x-show="open" style="display:none;">
        ${renderModifierTable('modifier-ungrouped-items', rows)}
      </div>
    </div>
  `;
}

export function renderModifiersAccordion(groups, ungroupedModifiers, allModifiers) {
  const sections = groups
    .map((g) => renderGroupAccordionSection(g, allModifiers.filter((m) => m.group_id === g.id)))
    .join('');
  const ungrouped = renderUngroupedAccordionSection(ungroupedModifiers);
  return `<div id="modifiers-accordion">${sections}${ungrouped}</div>`;
}

/* ---------- Модалки добавления ---------- */

export function renderGroupSelectOob(groups) {
  return `<select name="group_id" id="modifier-group-select" hx-swap-oob="true">${groupSelectOptions(groups, null)}</select>`;
}

function renderAddGroupModal() {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Группа</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новая группа модификаторов</h3>
          <p class="hint">
            Группа задаёт ограничение выбора на терминале — например, «Лаваш»
            с максимумом 1 (ровно один вариант) или «Соусы» с максимумом 2.
            Обычным ингредиентам блюда группа не нужна.
          </p>
          <form
            hx-post="/modifiers/groups"
            hx-target="#modifier-group-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Название группы" required>
            <input type="number" min="0" name="min_select" placeholder="Мин. выбор (0)" value="0">
            <input type="number" min="1" name="max_select" placeholder="Макс. выбор (пусто = без лимита)">
            <div id="modifier-group-form-error" class="error"></div>
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

function renderAddModifierModal(groups, warehouseItems) {
  return `
    <div class="modal-trigger" x-data="{ open: false }" @htmx:after-request="if ($event.detail.successful) open = false">
      <button type="button" class="btn-secondary" @click="open = true">+ Модификатор</button>
      <div class="modal-backdrop" x-show="open" @click.self="open = false" style="display:none;">
        <div class="modal-box">
          <h3>Новый модификатор</h3>
          <form
            hx-post="/modifiers"
            hx-target="#modifier-form-error"
            hx-swap="innerHTML"
            hx-on::after-request="if(event.detail.successful) this.reset()"
          >
            <input type="text" name="name" placeholder="Название, напр. Картофель фри" required>
            <input type="number" step="0.01" min="0" name="price" placeholder="Цена (0 — бесплатно)" value="0" required>
            <select name="group_id" id="modifier-group-select">${groupSelectOptions(groups, null)}</select>
            <select name="warehouse_item_id">${warehouseItemSelectOptions(warehouseItems, null)}</select>
            <input type="number" step="0.001" min="0" name="qty" placeholder="Кол-во для списания">
            <div id="modifier-form-error" class="error"></div>
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

export function renderModifiersSection(groups, ungroupedModifiers, allModifiers, warehouseItems) {
  return `
    <header>
      <h1>Модификаторы</h1>
      <p>Единый каталог ингредиентов и платных добавок для позиций меню</p>
    </header>

    <div class="subsection">
      <p class="hint">
        Здесь — общий каталог: любой модификатор можно прикрепить к нескольким
        позициям меню сразу (в разделе «Меню» → «Модификаторы» у позиции).
        Обычные ингредиенты (без группы) — бесплатны и просто входят/не входят
        в блюдо. Модификаторы в группе — ограничены по количеству выбора
        (например, «Лаваш» — ровно один вариант) и обычно платные.
      </p>
      <div class="subsection-header">
        <h2>Каталог</h2>
        <div class="subsection-actions">
          ${renderAddGroupModal()}
          ${renderAddModifierModal(groups, warehouseItems)}
        </div>
      </div>
      ${renderModifiersAccordion(groups, ungroupedModifiers, allModifiers)}
    </div>
  `;
}

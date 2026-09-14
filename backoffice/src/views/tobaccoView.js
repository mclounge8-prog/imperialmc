import { escapeHtml } from './escapeHtml.js';

function formatG(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} г`;
}

export function renderTobaccoTaresSection({ tares = [], errorMsg = null } = {}) {
  const errorHtml = errorMsg ? `<p class="field-error">${escapeHtml(errorMsg)}</p>` : '';
  const rows = tares
    .map(
      (t) => `
      <tr id="tobacco-tare-row-${t.id}">
        <td>${escapeHtml(t.brand)}</td>
        <td>${escapeHtml(t.label)}</td>
        <td>${t.net_content_g != null ? formatG(t.net_content_g) : '—'}</td>
        <td>${formatG(t.tare_weight_g)}</td>
        <td>${t.is_active ? 'да' : 'нет'}</td>
        <td class="row-actions">
          <button
            type="button"
            hx-get="/tobacco-tares/${t.id}/edit"
            hx-target="#tobacco-tare-row-${t.id}"
            hx-swap="outerHTML"
          >Изменить</button>
          <button
            type="button"
            class="danger"
            hx-delete="/tobacco-tares/${t.id}"
            hx-target="#tobacco-tare-row-${t.id}"
            hx-swap="outerHTML"
            hx-confirm="Удалить тару «${escapeHtml(t.label)}»?"
          >Удалить</button>
        </td>
      </tr>
    `
    )
    .join('');

  return `
    <header>
      <h1>Тары табака</h1>
      <p>Вес пустой банки по бренду и фасовке (MustHave 125, MustHave 250…). Нужен, чтобы на терминале вычитать тару из взвешивания. На каждое заведение можно подключить сразу много разных тар.</p>
    </header>

    <section class="subsection">
      <h2>Добавить тару</h2>
      ${errorHtml}
      <form
        class="inline-form tobacco-tare-form"
        hx-post="/tobacco-tares"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >
        <input type="text" name="brand" placeholder="Бренд (MustHave)" required>
        <input type="text" name="label" placeholder="Название (MustHave 125)" required>
        <input type="number" name="net_content_g" placeholder="Нетто, г (125)" step="0.1" min="0">
        <input type="number" name="tare_weight_g" placeholder="Вес тары, г" step="0.1" min="0" required>
        <button type="submit">Добавить</button>
      </form>
    </section>

    <section class="subsection">
      <h2>Каталог</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Бренд</th>
              <th>Название</th>
              <th>Нетто</th>
              <th>Вес тары</th>
              <th>Активна</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6" class="empty-hint">Пока нет ни одной тары</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderTobaccoTareEditRow(tare, errorMsg = null) {
  const errorHtml = errorMsg
    ? `<div class="field-error" style="margin-bottom:8px">${escapeHtml(errorMsg)}</div>`
    : '';
  return `
    <tr id="tobacco-tare-row-${tare.id}">
      <td colspan="6">
        ${errorHtml}
        <form
          class="inline-form tobacco-tare-form"
          hx-put="/tobacco-tares/${tare.id}"
          hx-target="#main-content"
          hx-swap="innerHTML"
        >
          <input type="text" name="brand" value="${escapeHtml(tare.brand)}" required>
          <input type="text" name="label" value="${escapeHtml(tare.label)}" required>
          <input type="number" name="net_content_g" value="${tare.net_content_g ?? ''}" step="0.1" min="0" placeholder="Нетто, г">
          <input type="number" name="tare_weight_g" value="${tare.tare_weight_g}" step="0.1" min="0" required>
          <label class="inline-check">
            <input type="checkbox" name="is_active" value="1" ${tare.is_active ? 'checked' : ''}>
            активна
          </label>
          <button type="submit">Сохранить</button>
          <button type="button" hx-get="/fragments/tobacco-tares" hx-target="#main-content" hx-swap="innerHTML">Отмена</button>
        </form>
      </td>
    </tr>
  `;
}

export function renderVenueTobaccoPanel({
  venue,
  warehouseItems,
  tares,
  selectedItemIds,
  selectedTareIds,
}) {
  const enabled = !!venue.tobacco_accounting_enabled;
  const tolerance = Number(venue.tobacco_tolerance_g ?? 100);
  const selectedItems = new Set(selectedItemIds.map(String));
  const selectedTares = new Set(selectedTareIds.map(String));

  const itemRows = warehouseItems
    .map((item) => {
      const checked = selectedItems.has(String(item.id));
      return `
        <label class="tobacco-check-row">
          <input type="checkbox" name="item_${item.id}" value="1" ${checked ? 'checked' : ''}>
          <span>${escapeHtml(item.name)} <em>${escapeHtml(item.unit || '')}</em></span>
        </label>
      `;
    })
    .join('');

  const tareRows = tares
    .filter((t) => t.is_active)
    .map((t) => {
      const checked = selectedTares.has(String(t.id));
      return `
        <label class="tobacco-check-row">
          <input type="checkbox" name="tare_${t.id}" value="1" ${checked ? 'checked' : ''}>
          <span>${escapeHtml(t.label)} <em>тара ${formatG(t.tare_weight_g)}</em></span>
        </label>
      `;
    })
    .join('');

  return `
    <div class="venue-tobacco-panel" id="venue-tobacco-panel-${venue.id}">
      <div class="venue-tobacco-head">
        <strong>Учёт табака</strong>
        <span class="hint">${enabled ? 'включён' : 'выключен'}</span>
      </div>
      <form
        class="venue-tobacco-form"
        hx-post="/venues/${venue.id}/tobacco-settings"
        hx-target="#venue-tobacco-panel-${venue.id}"
        hx-swap="outerHTML"
      >
        <label class="venue-precheck-toggle">
          <input type="checkbox" name="enabled" value="1" ${enabled ? 'checked' : ''}>
          <span>Включить учёт табака на этом заведении</span>
        </label>
        <label class="field-block">
          <span>Допустимая погрешность, г</span>
          <input type="number" name="tolerance_g" value="${tolerance}" step="1" min="0" required>
        </label>

        <h3 class="tobacco-subhead">1. Тары на точке</h3>
        <p class="hint">Отметьте все виды банок, которыми пользуетесь (разный вес тары). На терминале по каждой будет своё кол-во и взвешивание.</p>
        <div class="tobacco-item-list">
          ${tareRows || '<p class="empty-hint">Сначала добавьте тары в разделе «Тары табака»</p>'}
        </div>

        <h3 class="tobacco-subhead">2. Складские позиции для сверки остатка</h3>
        <p class="hint">Какие остатки табака сравнивать с суммарным чистым весом после подсчёта. Привязка «одна тара на позицию» не нужна.</p>
        <div class="tobacco-item-list">
          ${itemRows || '<p class="empty-hint">Сначала заведите номенклатуру на складе</p>'}
        </div>

        <div class="venue-actions">
          <button type="submit">Сохранить учёт табака</button>
        </div>
      </form>
    </div>
  `;
}

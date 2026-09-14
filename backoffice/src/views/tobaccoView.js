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
      <p>Вес пустой банки по бренду и фасовке (MustHave 125, MustHave 250…). Нужен, чтобы на терминале вычитать тару из взвешивания.</p>
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
  selectedMap,
}) {
  const enabled = !!venue.tobacco_accounting_enabled;
  const tolerance = Number(venue.tobacco_tolerance_g ?? 100);
  const itemRows = warehouseItems
    .map((item) => {
      const selected = selectedMap.get(item.id);
      const checked = Boolean(selected);
      const tareId = selected?.tobacco_tare_id ? String(selected.tobacco_tare_id) : '';
      const options =
        `<option value="">— тара —</option>` +
        tares
          .filter((t) => t.is_active)
          .map((t) => {
            const id = String(t.id);
            return `<option value="${id}"${id === tareId ? ' selected' : ''}>${escapeHtml(t.label)} (${formatG(t.tare_weight_g)})</option>`;
          })
          .join('');
      return `
        <label class="tobacco-item-row">
          <input
            type="checkbox"
            name="item_${item.id}"
            value="1"
            ${checked ? 'checked' : ''}
            onchange="this.closest('.tobacco-item-row').querySelector('select').disabled=!this.checked"
          >
          <span class="tobacco-item-name">${escapeHtml(item.name)} <em>${escapeHtml(item.unit || '')}</em></span>
          <select name="tare_${item.id}" ${checked ? '' : 'disabled'}>
            ${options}
          </select>
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
        <p class="hint">Отметьте складские позиции (обычно в граммах) и укажите тару бренда. На терминале появятся раздел «Учёт» и проверка при закрытии смены.</p>
        <div class="tobacco-item-list">
          ${itemRows || '<p class="empty-hint">Сначала заведите номенклатуру на складе</p>'}
        </div>
        ${
          tares.length === 0
            ? '<p class="field-error">Сначала добавьте тары в разделе «Тары табака»</p>'
            : ''
        }
        <div class="venue-actions">
          <button type="submit">Сохранить учёт табака</button>
        </div>
      </form>
    </div>
  `;
}

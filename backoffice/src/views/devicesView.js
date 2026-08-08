import { escapeHtml } from './escapeHtml.js';

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function venueOptions(venues, selectedId) {
  const options = venues
    .map((v) => {
      const isSelected = String(v.id) === String(selectedId) ? ' selected' : '';
      return `<option value="${v.id}"${isSelected}>${escapeHtml(v.name)}</option>`;
    })
    .join('');
  return `<option value="">Не назначено</option>${options}`;
}

export function renderDeviceRow(device, venues, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="beforeend:#devices-list"' : '';
  const displayName = device.name ? escapeHtml(device.name) : `Устройство #${device.id}`;
  const statusLabel = device.is_active ? 'Активно' : 'Деактивировано';
  const statusClass = device.is_active ? 'badge-active' : 'badge-inactive';
  const toggleLabel = device.is_active ? 'Деактивировать' : 'Активировать';
  const lastSeen = formatDateTime(device.last_seen_at);
  const lastSeenText = lastSeen ? `был(о) на связи ${lastSeen}` : 'ещё не выходило на связь';

  return `
    <div class="list-row device-row" id="device-row-${device.id}"${oobAttr}>
      <div class="device-info">
        <input
          type="text"
          class="device-name-input"
          value="${device.name ? escapeHtml(device.name) : ''}"
          placeholder="${displayName}"
          name="name"
          hx-put="/devices/${device.id}/name"
          hx-trigger="change"
          hx-target="#device-row-${device.id}"
          hx-swap="outerHTML"
        >
        <span class="device-meta">
          <span class="badge ${statusClass}">${statusLabel}</span>
          ${lastSeenText}
        </span>
      </div>
      <select
        name="venue_id"
        hx-put="/devices/${device.id}/venue"
        hx-trigger="change"
        hx-target="#device-row-${device.id}"
        hx-swap="outerHTML"
      >${venueOptions(venues, device.venue_id)}</select>
      <div class="row-actions">
        <button hx-post="/devices/${device.id}/toggle-active" hx-target="#device-row-${device.id}" hx-swap="outerHTML">${toggleLabel}</button>
        <button
          class="danger"
          hx-delete="/devices/${device.id}"
          hx-target="#device-row-${device.id}"
          hx-swap="outerHTML"
          hx-confirm="Удалить устройство совсем? Планшету придётся регистрироваться заново по новому коду."
        >Удалить</button>
      </div>
    </div>
  `;
}

export function renderRegistrationCode(code, expiresAt) {
  const expiresText = formatDateTime(expiresAt);
  return `
    <div class="reg-code-box">
      <div class="reg-code">${escapeHtml(code)}</div>
      <p class="hint">Введи этот код на новом планшете, в приложении, на экране регистрации. Действует до ${expiresText}, одноразовый.</p>
    </div>
  `;
}

export function renderDeviceListInner(devices, venues) {
  const rows = devices.map((d) => renderDeviceRow(d, venues)).join('');
  return rows || '<p class="empty-hint">Пока нет ни одного зарегистрированного устройства</p>';
}

export function renderDevicesSection(devices, venues) {
  return `
    <header>
      <h1>Устройства</h1>
      <p>Android-терминалы — регистрация, назначение на заведение, активация</p>
    </header>

    <div class="subsection">
      <h2>Новое устройство</h2>
      <button
        class="section-form-button-standalone"
        hx-post="/devices/generate-code"
        hx-target="#registration-code-display"
        hx-swap="innerHTML"
      >Сгенерировать код регистрации</button>
      <div id="registration-code-display"></div>
      <p class="hint">
        Список ниже сам подхватит новое устройство, как только планшет введёт код —
        обновлять страницу не нужно.
      </p>
    </div>

    <div class="subsection">
      <h2>Зарегистрированные устройства</h2>
      <div
        class="list"
        id="devices-list"
        hx-get="/devices/list"
        hx-trigger="every 10s"
        hx-swap="innerHTML"
        hx-on::before-request="if (event.detail.elt === this && this.contains(document.activeElement)) { event.preventDefault(); }"
      >${renderDeviceListInner(devices, venues)}</div>
    </div>
  `;
}

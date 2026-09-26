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
  const kind = device.kind === 'kiosk' ? 'kiosk' : 'staff';
  const kindLabel = kind === 'kiosk' ? 'Киоск' : 'Терминал';
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
          <span class="badge ${kind === 'kiosk' ? 'badge-kiosk' : 'badge-staff'}">${kindLabel}</span>
          ${lastSeenText}
        </span>
      </div>
      <select
        name="kind"
        hx-put="/devices/${device.id}/kind"
        hx-trigger="change"
        hx-target="#device-row-${device.id}"
        hx-swap="outerHTML"
      >
        <option value="staff"${kind === 'staff' ? ' selected' : ''}>Терминал</option>
        <option value="kiosk"${kind === 'kiosk' ? ' selected' : ''}>Киоск</option>
      </select>
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
          hx-confirm="Удалить устройство совсем? На планшете откроется экран регистрации — сгенерируй новый код и введи его там. Чтобы просто сменить точку, достаточно выбрать другое заведение слева, без удаления."
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
      <p>Android-терминалы и киоски — регистрация, назначение на заведение, активация</p>
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
        Список ниже сам подхватит новое устройство, как только планшет или киоск введёт код —
        обновлять страницу не нужно. Киоск открывается по адресу
        <a href="/kiosk/" target="_blank" rel="noopener">/kiosk/</a>.
        Тип (терминал / киоск) можно сменить в списке. Чтобы перенести на другую точку,
        смени заведение — удалять устройство не нужно.
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

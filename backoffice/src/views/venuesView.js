import { escapeHtml } from './escapeHtml.js';

export function renderVenueCard(venue, assignedNames, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="beforeend:#venues-list"' : '';
  const safeName = escapeHtml(venue.name);
  const safeAddress = venue.address ? escapeHtml(venue.address) : '—';
  const summaryText = assignedNames.length
    ? assignedNames.map((n) => escapeHtml(n)).join(', ')
    : 'Сотрудники не назначены';

  return `
    <div class="venue-card" id="venue-card-${venue.id}"${oobAttr}>
      <div class="venue-main">
        <div class="venue-info">
          <div class="venue-name">${safeName}</div>
          <div class="venue-address">${safeAddress}</div>
        </div>
        <div class="venue-staff-summary" id="venue-staff-summary-${venue.id}">${summaryText}</div>
        <div class="venue-actions">
          <button hx-get="/venues/${venue.id}/staff" hx-target="#venue-staff-panel-${venue.id}" hx-swap="innerHTML">Сотрудники</button>
          <button hx-get="/venues/${venue.id}/edit" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML">Изменить</button>
          <button class="danger" hx-delete="/venues/${venue.id}" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML" hx-confirm="Удалить заведение «${safeName}»? Это затронет всё, что к нему привязано.">Удалить</button>
        </div>
      </div>
      <div id="venue-staff-panel-${venue.id}" class="venue-staff-panel"></div>
    </div>
  `;
}

export function renderVenueEditCard(venue, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  return `
    <div class="venue-card" id="venue-card-${venue.id}">
      <div class="venue-edit-form">
        <input type="text" name="name" value="${escapeHtml(venue.name)}" placeholder="Название" required>
        <input type="text" name="address" value="${venue.address ? escapeHtml(venue.address) : ''}" placeholder="Адрес">
        ${errorHtml}
        <div class="venue-actions">
          <button type="button" hx-put="/venues/${venue.id}" hx-include="closest .venue-edit-form" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML">Сохранить</button>
          <button type="button" hx-get="/venues/${venue.id}/view" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML">Отмена</button>
        </div>
      </div>
    </div>
  `;
}

export function renderVenueStaffPanel(venue, staffList, assignedStaffIds, { withSummaryOob = false } = {}) {
  const rows = staffList
    .map((s) => {
      const checked = assignedStaffIds.includes(s.id);
      return `
        <label class="staff-check-row">
          <input
            type="checkbox"
            ${checked ? 'checked' : ''}
            hx-post="/venues/${venue.id}/staff/${s.id}/toggle"
            hx-target="#venue-staff-panel-${venue.id}"
            hx-swap="innerHTML"
          >
          <span>${escapeHtml(s.name)}</span>
        </label>
      `;
    })
    .join('');

  const checklist = `<div class="staff-checklist">${
    rows || '<p class="empty-hint">Сначала добавь сотрудников в разделе «Сотрудники»</p>'
  }</div>`;

  if (!withSummaryOob) return checklist;

  const assignedNames = staffList
    .filter((s) => assignedStaffIds.includes(s.id))
    .map((s) => escapeHtml(s.name));
  const summaryText = assignedNames.length ? assignedNames.join(', ') : 'Сотрудники не назначены';
  const summaryOob = `<div id="venue-staff-summary-${venue.id}" class="venue-staff-summary" hx-swap-oob="true">${summaryText}</div>`;

  return checklist + summaryOob;
}

export function renderVenuesSection(venueCards) {
  const cards = venueCards.map(({ venue, assignedNames }) => renderVenueCard(venue, assignedNames)).join('');

  return `
    <header>
      <h1>Заведения</h1>
      <p>Точки продаж — у каждой свой склад, свои столы и назначенные сотрудники</p>
    </header>

    <form
      id="add-venue-form"
      class="section-form"
      hx-post="/venues"
      hx-target="#venue-form-error"
      hx-swap="innerHTML"
      hx-on::after-request="if(event.detail.successful) this.reset()"
    >
      <input type="text" name="name" placeholder="Название заведения" required>
      <input type="text" name="address" placeholder="Адрес">
      <button type="submit">Добавить заведение</button>
      <div id="venue-form-error" class="error"></div>
    </form>

    <div class="venues-list" id="venues-list">${cards}</div>
  `;
}

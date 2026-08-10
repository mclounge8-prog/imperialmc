import { escapeHtml } from './escapeHtml.js';

export function renderVenueCard(venue, assignedNames) {
  const safeName = escapeHtml(venue.name);
  const safeAddress = venue.address ? escapeHtml(venue.address) : '—';
  const summaryText = assignedNames.length
    ? assignedNames.map((n) => escapeHtml(n)).join(', ')
    : 'Сотрудники не назначены';

  return `
    <div class="venue-card" id="venue-card-${venue.id}">
      <div class="venue-main">
        <div class="venue-info">
          <div class="venue-name">${safeName}</div>
          <div class="venue-address">${safeAddress}</div>
        </div>
        <div class="venue-staff-summary" id="venue-staff-summary-${venue.id}">${summaryText}</div>
        <div class="venue-actions">
          <button hx-get="/venues/${venue.id}/staff" hx-target="#venue-staff-panel-${venue.id}" hx-swap="innerHTML">Сотрудники</button>
          <button hx-get="/venues/${venue.id}/atol" hx-target="#venue-atol-panel-${venue.id}" hx-swap="innerHTML">Касса АТОЛ</button>
          <button hx-get="/venues/${venue.id}/edit" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML">Изменить</button>
          <button class="danger" hx-delete="/venues/${venue.id}" hx-target="#venue-card-${venue.id}" hx-swap="outerHTML" hx-confirm="Удалить заведение «${safeName}»? Это затронет всё, что к нему привязано.">Удалить</button>
        </div>
      </div>
      <div id="venue-staff-panel-${venue.id}" class="venue-staff-panel"></div>
      <div id="venue-atol-panel-${venue.id}" class="venue-atol-panel"></div>
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

export function renderVenueListRows(venueCards) {
  return venueCards.map(({ venue, assignedNames }) => renderVenueCard(venue, assignedNames)).join('');
}

/**
 * Целиком список заведений с hx-swap-oob="true" — после создания нового
 * заведения сервер отдаёт свежий отсортированный по имени список, вместо
 * вставки карточки в конец (которая расходилась с алфавитным порядком при
 * обычной загрузке раздела).
 */
export function renderVenueListOob(venueCards) {
  return `<div class="venues-list" id="venues-list" hx-swap-oob="true">${renderVenueListRows(venueCards)}</div>`;
}

const FISCAL_JOB_TYPE_LABELS = {
  open_shift: 'Открытие смены',
  close_shift: 'Закрытие смены (Z-отчёт)',
  x_report: 'X-отчёт',
  receipt: 'Чек',
  cash_in: 'Внесение',
  cash_out: 'Инкассация',
};

const FISCAL_JOB_STATUS_LABELS = {
  pending: 'В очереди',
  in_progress: 'Выполняется',
  done: 'Готово',
  error: 'Ошибка',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderFiscalJobRow(job, venueId) {
  const typeLabel = FISCAL_JOB_TYPE_LABELS[job.type] || job.type;
  const statusLabel = FISCAL_JOB_STATUS_LABELS[job.status] || job.status;
  const errorHtml = job.last_error
    ? `<div class="fiscal-job-error">${escapeHtml(job.last_error)}</div>`
    : '';
  const retryHtml =
    job.status === 'error'
      ? `<button
           type="button"
           class="secondary fiscal-job-retry"
           hx-post="/venues/${venueId}/atol/jobs/${job.id}/retry"
           hx-target="#atol-jobs-tbody-${venueId}"
           hx-swap="innerHTML"
         >Повторить</button>`
      : '';
  return `
    <tr class="fiscal-job-row fiscal-job-${job.status}">
      <td>${formatDateTime(job.created_at)}</td>
      <td>${escapeHtml(typeLabel)}</td>
      <td><span class="fiscal-job-badge fiscal-job-badge-${job.status}">${escapeHtml(statusLabel)}</span>${errorHtml}</td>
      <td>${job.fiscal_doc_number || '—'}</td>
      <td>${retryHtml}</td>
    </tr>
  `;
}

export function renderVenueAtolPanel(venue, settings, jobs) {
  const safe = settings || { enabled: false, kkt_port: 5555 };

  const jobsHtml = jobs.length
    ? jobs.map((job) => renderFiscalJobRow(job, venue.id)).join('')
    : '<tr><td colspan="5" class="empty-hint">Заданий пока не было</td></tr>';

  return `
    <div class="atol-settings" id="atol-settings-${venue.id}">
      <h3>Касса АТОЛ</h3>
      <p class="atol-hint">
        Система налогообложения и ставка НДС настраиваются один раз на самой кассе (как раньше в QuickResto) —
        здесь мы их не задаём. Фискализацию выполняет сам планшет-терминал (нужно приложение «Драйвер ККТ АТОЛ»,
        установленное на том же планшете) — никакого отдельного ПК/агента не требуется.
      </p>

      <form
        class="atol-settings-form"
        hx-post="/venues/${venue.id}/atol"
        hx-target="#venue-atol-panel-${venue.id}"
        hx-swap="innerHTML"
      >
        <label class="atol-toggle-row">
          <input type="checkbox" name="enabled" ${safe.enabled ? 'checked' : ''}>
          <span>Касса АТОЛ включена для этого заведения</span>
        </label>

        <div class="atol-fields-grid">
          <label>
            <span>IP-адрес кассы</span>
            <input type="text" name="kkt_ip" value="${safe.kkt_ip ? escapeHtml(safe.kkt_ip) : ''}" placeholder="192.168.1.50">
          </label>
          <label>
            <span>Порт (канал обмена)</span>
            <input type="number" name="kkt_port" value="${safe.kkt_port || 5555}" placeholder="5555">
          </label>
          <label>
            <span>Код модели (драйвер)</span>
            <input type="number" name="kkt_model" value="${safe.kkt_model || ''}" placeholder="см. Тест драйвера ККТ">
          </label>
          <label>
            <span>Оператор по умолчанию</span>
            <input type="text" name="operator_name" value="${safe.operator_name ? escapeHtml(safe.operator_name) : ''}" placeholder="ФИО кассира">
          </label>
        </div>

        <div class="venue-actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>

      <div class="atol-jobs-block">
        <div class="atol-jobs-header">
          <h4>Задания за сутки</h4>
          <button
            type="button"
            class="secondary"
            hx-get="/venues/${venue.id}/atol/jobs"
            hx-target="#atol-jobs-tbody-${venue.id}"
            hx-swap="innerHTML"
          >Обновить</button>
        </div>
        <p class="atol-hint">Старые записи автоматически удаляются через 7 дней.</p>
        <table class="data-table atol-jobs-table">
          <thead>
            <tr><th>Когда</th><th>Тип</th><th>Статус</th><th>№ ФД</th><th></th></tr>
          </thead>
          <tbody id="atol-jobs-tbody-${venue.id}">${jobsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderVenueAtolJobsRows(jobs, venueId) {
  return jobs.length
    ? jobs.map((job) => renderFiscalJobRow(job, venueId)).join('')
    : '<tr><td colspan="5" class="empty-hint">Заданий пока не было</td></tr>';
}

export function renderVenuesSection(venueCards) {
  const cards = renderVenueListRows(venueCards);

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

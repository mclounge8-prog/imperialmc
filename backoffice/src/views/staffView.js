import { escapeHtml } from './escapeHtml.js';

export const ROLES = {
  bartender: 'Бармен',
  hookah_master: 'Кальянщик',
  waiter: 'Официант',
};

function roleOptions(selected) {
  return Object.entries(ROLES)
    .map(([value, label]) => {
      const isSelected = value === selected ? ' selected' : '';
      return `<option value="${value}"${isSelected}>${label}</option>`;
    })
    .join('');
}

/**
 * Строка в режиме просмотра.
 * oob=true — используется только при создании нового сотрудника:
 * добавляет hx-swap-oob, чтобы вставить строку в конец таблицы,
 * пока основной hx-target формы указывает на блок ошибки.
 */
export function renderStaffRow(staffMember, { oob = false } = {}) {
  const oobAttr = oob ? ' hx-swap-oob="beforeend:#staff-list"' : '';
  const statusLabel = staffMember.is_active ? 'Активен' : 'Отключён';
  const statusClass = staffMember.is_active ? 'badge-active' : 'badge-inactive';
  const toggleLabel = staffMember.is_active ? 'Деактивировать' : 'Активировать';
  const safeName = escapeHtml(staffMember.name);

  return `
    <tr id="staff-row-${staffMember.id}"${oobAttr}>
      <td>${safeName}</td>
      <td>${ROLES[staffMember.role] || staffMember.role}</td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td class="row-actions">
        <button hx-get="/staff/${staffMember.id}/edit" hx-target="#staff-row-${staffMember.id}" hx-swap="outerHTML">Изменить</button>
        <button hx-post="/staff/${staffMember.id}/toggle" hx-target="#staff-row-${staffMember.id}" hx-swap="outerHTML">${toggleLabel}</button>
        <button class="danger" hx-delete="/staff/${staffMember.id}" hx-target="#staff-row-${staffMember.id}" hx-swap="outerHTML" hx-confirm="Удалить сотрудника «${safeName}»?">Удалить</button>
      </td>
    </tr>
  `;
}

/** Строка в режиме редактирования. errorMsg — если предыдущая попытка сохранить не прошла валидацию. */
export function renderStaffEditRow(staffMember, errorMsg = null) {
  const errorHtml = errorMsg ? `<div class="field-error">${escapeHtml(errorMsg)}</div>` : '';

  return `
    <tr id="staff-row-${staffMember.id}">
      <td><input type="text" name="name" value="${escapeHtml(staffMember.name)}" required></td>
      <td><select name="role">${roleOptions(staffMember.role)}</select></td>
      <td>
        <input type="text" name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="новый PIN">
        ${errorHtml}
      </td>
      <td class="row-actions">
        <button hx-put="/staff/${staffMember.id}" hx-include="closest tr" hx-target="#staff-row-${staffMember.id}" hx-swap="outerHTML">Сохранить</button>
        <button hx-get="/staff/${staffMember.id}/view" hx-target="#staff-row-${staffMember.id}" hx-swap="outerHTML">Отмена</button>
      </td>
    </tr>
  `;
}

export function renderStaffSection(staffList) {
  const rows = staffList.map((s) => renderStaffRow(s)).join('');

  return `
    <header>
      <h1>Сотрудники</h1>
      <p>Сотрудники и роли для входа по PIN на терминале</p>
    </header>

    <form
      id="add-staff-form"
      class="section-form"
      hx-post="/staff"
      hx-target="#staff-form-error"
      hx-swap="innerHTML"
      hx-on::after-request="if(event.detail.successful) this.reset()"
    >
      <input type="text" name="name" placeholder="Имя" required>
      <select name="role" required>
        <option value="">Роль…</option>
        ${roleOptions(null)}
      </select>
      <input type="text" name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="PIN (4 цифры)" required>
      <button type="submit">Добавить сотрудника</button>
      <div id="staff-form-error" class="error"></div>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>Имя</th>
          <th>Роль</th>
          <th>Статус</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody id="staff-list">${rows}</tbody>
    </table>
  `;
}

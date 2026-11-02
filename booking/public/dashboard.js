const STATUSES = {
  new: 'Новая',
  reserved: 'Бронь',
  paid: 'Оплачено',
  cancelled: 'Отменена',
};

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin();
    throw new Error('auth');
  }
  if (!response.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function prettyPhone(phone) {
  const digits = String(phone || '');
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

function showLogin() {
  document.querySelector('#login').hidden = false;
  document.querySelector('#desk').hidden = true;
}

function showDesk() {
  document.querySelector('#login').hidden = true;
  document.querySelector('#desk').hidden = false;
}

async function load() {
  const data = await api('/api/admin/bookings');
  showDesk();
  const counts = { new: 0, reserved: 0, paid: 0, cancelled: 0 };
  for (const booking of data.bookings) counts[booking.status] += 1;
  document.querySelector('#stats').innerHTML = [
    ['new', 'ждут'],
    ['reserved', 'бронь'],
    ['paid', 'оплачено'],
    ['cancelled', 'отмены'],
  ].map(([key, label]) => `<div class="stat"><b>${counts[key]}</b><span>${label}</span></div>`).join('');

  document.querySelector('#seats').innerHTML = data.tables.map((table) => `
    <article class="panel">
      <strong>${table.zone} · ${table.name}</strong>
      <label class="field"><span>Мест к брони</span>
        <input data-seats="${table.id}" type="number" min="1" max="30" value="${table.seats}">
      </label>
      <label><input data-open="${table.id}" type="checkbox" ${table.bookable ? 'checked' : ''}> открыт для брони</label>
      <button class="ghost" type="button" data-save="${table.id}">Сохранить места</button>
    </article>
  `).join('');

  document.querySelector('#board').innerHTML = data.bookings.length
    ? data.bookings.map((booking) => `
      <article class="panel ticket">
        <div>
          <div class="badge ${booking.status}">${STATUSES[booking.status]}</div>
          <p>${booking.date.split('-').reverse().join('.')} · ${booking.time}</p>
        </div>
        <div>
          <h3>${booking.tableName} · ${booking.guests} из ${booking.seats}</h3>
          <p>${booking.name} · ${prettyPhone(booking.phone)}${booking.comment ? ` · ${booking.comment}` : ''}</p>
          <p>${booking.zone}</p>
        </div>
        <div class="actions">
          ${booking.status === 'new' ? `<button class="ghost" data-status="reserved" data-id="${booking.id}">Подтвердить бронь</button>` : ''}
          ${booking.status === 'new' || booking.status === 'reserved' ? `<button class="ghost" data-status="paid" data-id="${booking.id}">Оплата получена</button>` : ''}
          ${booking.status !== 'cancelled' ? `<button class="danger" data-status="cancelled" data-id="${booking.id}">Отменить</button>` : ''}
        </div>
      </article>
    `).join('')
    : '<p class="note">Пока заявок нет.</p>';
}

document.querySelector('#loginForm').onsubmit = async (event) => {
  event.preventDefault();
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: event.currentTarget.password.value }),
  });
  const data = await response.json();
  if (!response.ok) {
    document.querySelector('#loginError').textContent = data.error || 'Не вышло';
    return;
  }
  load().catch(() => {});
};

document.querySelector('#logout').onclick = async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLogin();
};

document.querySelector('#desk').onclick = async (event) => {
  const save = event.target.closest('[data-save]');
  const status = event.target.closest('[data-status]');
  try {
    if (save) {
      const id = save.dataset.save;
      await api(`/api/admin/tables/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          seats: Number(document.querySelector(`[data-seats="${id}"]`).value),
          bookable: document.querySelector(`[data-open="${id}"]`).checked,
        }),
      });
      await load();
    }
    if (status) {
      await api(`/api/admin/bookings/${status.dataset.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: status.dataset.status }),
      });
      await load();
    }
  } catch (err) {
    if (err.message !== 'auth') alert(err.message);
  }
};

load().catch(() => showLogin());

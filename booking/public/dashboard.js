const STATUSES = {
  new: 'Новая',
  reserved: 'Бронь',
  paid: 'Оплачено',
  cancelled: 'Отменена',
};

const SIZES = {
  small: [80, 80],
  medium: [120, 80],
  large: [160, 120],
};

const state = {
  data: null,
  zone: '',
  tableId: null,
  size: 'medium',
};

const floorEl = document.querySelector('#floor');
const zonesEl = document.querySelector('#zones');
const editor = document.querySelector('#tableEditor');

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

function sizeOf(table) {
  if (table.w >= 160 || table.h >= 120) return 'large';
  if (table.w <= 80 && table.h <= 80) return 'small';
  return 'medium';
}

function zonesOf(tables) {
  const zones = [];
  for (const table of tables) {
    let zone = zones.find((item) => item.name === table.zone);
    if (!zone) {
      zone = {
        name: table.zone,
        order: table.zoneOrder,
        bounds: { width: table.boundsW, height: table.boundsH },
        tables: [],
      };
      zones.push(zone);
    }
    zone.tables.push(table);
  }
  zones.sort((a, b) => a.order - b.order);
  return zones;
}

function currentZone() {
  return zonesOf(state.data?.tables || []).find((zone) => zone.name === state.zone);
}

function selectedTable() {
  return currentZone()?.tables.find((table) => table.id === state.tableId) || null;
}

function renderEditor() {
  const table = selectedTable();
  editor.hidden = !table;
  if (!table) return;
  state.size = sizeOf(table);
  document.querySelector('#editorTitle').textContent = `${table.zone} · ${table.name}`;
  document.querySelector('#editorSeats').value = table.seats;
  document.querySelector('#editorOpen').checked = table.bookable;
  document.querySelectorAll('#editorSizes .chip').forEach((chip) => {
    chip.classList.toggle('on', chip.dataset.size === state.size);
  });
}

function renderPlan() {
  const zones = zonesOf(state.data?.tables || []);
  if (!state.zone || !zones.some((zone) => zone.name === state.zone)) {
    state.zone = zones[0]?.name || '';
  }
  zonesEl.innerHTML = zones.map((zone) =>
    `<button type="button" class="chip zone ${zone.name === state.zone ? 'on' : ''}" data-zone="${zone.name}">${zone.name}</button>`
  ).join('');
  const zone = currentZone();
  if (!zone) {
    floorEl.replaceChildren();
    return;
  }
  const stage = mountPlan(floorEl, zone);
  stage.innerHTML = zone.tables.map((table) => `
    <button type="button" class="table ${table.h <= 80 ? 'compact' : ''} ${table.id === state.tableId ? 'selected' : ''} ${table.bookable ? '' : 'closed'}"
      data-id="${table.id}" style="${placeTable(table)}">
      <span class="name">${table.name}</span>
      <span class="count">${table.seats}</span>
    </button>
  `).join('');
  renderEditor();
}

function renderBookings() {
  const bookings = state.data?.bookings || [];
  const counts = { new: 0, reserved: 0, paid: 0, cancelled: 0 };
  for (const booking of bookings) counts[booking.status] += 1;
  document.querySelector('#stats').innerHTML = [
    ['new', 'ждут'],
    ['reserved', 'бронь'],
    ['paid', 'оплачено'],
    ['cancelled', 'отмены'],
  ].map(([key, label]) => `<div class="stat"><b>${counts[key]}</b><span>${label}</span></div>`).join('');
  document.querySelector('#board').innerHTML = bookings.length
    ? bookings.map((booking) => `
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

async function load() {
  state.data = await api('/api/admin/bookings');
  showDesk();
  renderBookings();
  renderPlan();
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

zonesEl.addEventListener('click', (event) => {
  const zone = event.target.closest('[data-zone]')?.dataset.zone;
  if (!zone) return;
  state.zone = zone;
  state.tableId = null;
  renderPlan();
});

document.querySelector('#editorSizes').addEventListener('click', (event) => {
  const size = event.target.closest('[data-size]')?.dataset.size;
  if (!size || !SIZES[size]) return;
  state.size = size;
  document.querySelectorAll('#editorSizes .chip').forEach((chip) => {
    chip.classList.toggle('on', chip.dataset.size === size);
  });
});

editor.onsubmit = async (event) => {
  event.preventDefault();
  const table = selectedTable();
  if (!table) return;
  try {
    await api(`/api/admin/tables/${table.id}`, {
      method: 'POST',
      body: JSON.stringify({
        seats: Number(document.querySelector('#editorSeats').value),
        bookable: document.querySelector('#editorOpen').checked,
        size: state.size,
      }),
    });
    await load();
  } catch (err) {
    if (err.message !== 'auth') alert(err.message);
  }
};

let drag = null;

floorEl.addEventListener('pointerdown', (event) => {
  const tile = event.target.closest('.table');
  if (!tile) return;
  const table = currentZone()?.tables.find((item) => item.id === Number(tile.dataset.id));
  if (!table) return;
  drag = {
    id: table.id,
    pointer: event.pointerId,
    sx: event.clientX,
    sy: event.clientY,
    ox: table.x,
    oy: table.y,
    w: table.w,
    h: table.h,
    x: table.x,
    y: table.y,
    moved: false,
  };
  tile.setPointerCapture(event.pointerId);
});

floorEl.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const scale = Number(floorEl.querySelector('.plan')?.dataset.scale || 1);
  const dx = (event.clientX - drag.sx) / scale;
  const dy = (event.clientY - drag.sy) / scale;
  if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 4) drag.moved = true;
  const bounds = currentZone().bounds;
  drag.x = snapPlan(drag.ox + dx, bounds.width - drag.w);
  drag.y = snapPlan(drag.oy + dy, bounds.height - drag.h);
  const tile = floorEl.querySelector(`[data-id="${drag.id}"]`);
  tile.style.left = `${drag.x}px`;
  tile.style.top = `${drag.y}px`;
});

floorEl.addEventListener('pointerup', async (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const done = drag;
  drag = null;
  state.tableId = done.id;
  if (!done.moved) {
    renderPlan();
    return;
  }
  try {
    await api(`/api/admin/tables/${done.id}`, {
      method: 'POST',
      body: JSON.stringify({ x: done.x, y: done.y }),
    });
    const table = state.data.tables.find((item) => item.id === done.id);
    table.x = done.x;
    table.y = done.y;
    renderPlan();
  } catch (err) {
    if (err.message !== 'auth') alert(err.message);
    renderPlan();
  }
});

document.querySelector('#board').onclick = async (event) => {
  const status = event.target.closest('[data-status]');
  if (!status) return;
  try {
    await api(`/api/admin/bookings/${status.dataset.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: status.dataset.status }),
    });
    await load();
  } catch (err) {
    if (err.message !== 'auth') alert(err.message);
  }
};

window.addEventListener('resize', () => {
  if (state.data && !drag) renderPlan();
});

load().catch(() => showLogin());

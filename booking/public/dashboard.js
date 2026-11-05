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

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const state = {
  data: null,
  zone: '',
  tableId: null,
  size: 'medium',
  times: [],
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
  for (const zone of zones) zone.blocks = [];
  for (const block of state.data?.blocks || []) {
    const zone = zones.find((item) => item.name === block.zone);
    if (zone) zone.blocks.push(block);
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
  document.querySelector('#editorPrice').value = table.price || 0;
  document.querySelector('#editorOpen').checked = table.bookable;
  document.querySelectorAll('#editorSizes .chip').forEach((chip) => {
    chip.classList.toggle('on', chip.dataset.size === state.size);
  });
}

function nightSort(times) {
  const mins = (time) => {
    const [hour, minute] = time.split(':').map(Number);
    const value = hour * 60 + minute;
    return value < 360 ? value + 1440 : value;
  };
  return [...times].sort((a, b) => mins(a) - mins(b));
}

function hhmm(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[1]}:${match[2]}` : '';
}

function renderPool() {
  document.querySelector('#poolTimes').innerHTML = state.times.length
    ? state.times.map((time) => `<button type="button" class="chip" data-time="${time}">${time} <span aria-hidden="true">×</span></button>`).join('')
    : '<p class="note">Пул пуст. Соберите его или добавьте время.</p>';
}

function renderZoneToggles() {
  const zones = zonesOf(state.data?.tables || []);
  document.querySelector('#zoneToggles').innerHTML = zones.map((zone) => {
    const open = zone.tables[0]?.zoneOpen !== false;
    const name = zone.name.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
    return `<button type="button" class="chip ${open ? 'on' : ''}" data-zone-toggle="${name}" aria-pressed="${open}">${name}${open ? '' : ' · выкл'}</button>`;
  }).join('');
}

const paintDateFrom = mountDateField(document.querySelector('#dateFrom'), 'Без границы');
const paintDateTo = mountDateField(document.querySelector('#dateTo'), 'Без границы');

function applySchedule(schedule) {
  state.times = nightSort(schedule?.times || []);
  document.querySelector('#dateFrom').value = schedule?.dateFrom || '';
  document.querySelector('#dateTo').value = schedule?.dateTo || '';
  paintDateFrom();
  paintDateTo();
  renderPool();
  renderZoneToggles();
}

function renderPlan() {
  const zones = zonesOf(state.data?.tables || []);
  if (!state.zone || !zones.some((zone) => zone.name === state.zone)) {
    state.zone = zones[0]?.name || '';
  }
  zonesEl.innerHTML = zones.map((zone) => {
    const open = zone.tables[0]?.zoneOpen !== false;
    return `<button type="button" class="chip zone ${zone.name === state.zone ? 'on' : ''}" data-zone="${zone.name}">${zone.name}${open ? '' : ' · выкл'}</button>`;
  }).join('');
  const zone = currentZone();
  const pause = document.querySelector('#zonePause');
  if (!zone) {
    floorEl.replaceChildren();
    floorEl.classList.remove('zone-paused');
    if (pause) pause.hidden = true;
    return;
  }
  const guestsSee = zone.tables[0]?.zoneOpen !== false;
  floorEl.classList.toggle('zone-paused', !guestsSee);
  if (pause) pause.hidden = guestsSee;
  const stage = mountPlan(floorEl, zone);
  const blocks = (zone.blocks || []).map((block) => `
    <div class="table block ${block.h <= 80 ? 'compact' : ''}" style="${placeTable(block)}">
      <span class="name">${esc(block.name || 'Зона')}</span>
      <span class="count">${block.seats}</span>
    </div>
  `).join('');
  stage.innerHTML = blocks + zone.tables.map((table) => `
    <button type="button" class="table ${table.h <= 80 ? 'compact' : ''} ${table.id === state.tableId ? 'selected' : ''} ${table.bookable ? '' : 'closed'}"
      data-id="${table.id}" style="${placeTable(table)}" aria-label="${table.name}">
      <span class="name">${planLabel(table.name, stage.dataset.scale, table.w)}</span>
      <span class="count">${table.seats}</span>
      ${table.price ? `<span class="price">${formatMoney(table.price)}</span>` : ''}
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
          <h3>${booking.tableName} · ${booking.guests} из ${booking.seats}${booking.seatPrice ? ` · ${formatMoney(booking.guests * booking.seatPrice)}` : ''}</h3>
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
  applySchedule(state.data.schedule);
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
        price: Number(document.querySelector('#editorPrice').value),
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
  if (!tile || tile.classList.contains('block')) return;
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

document.querySelector('#zoneToggles').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-zone-toggle]');
  if (!button) return;
  const name = button.dataset.zoneToggle;
  const zone = zonesOf(state.data?.tables || []).find((item) => item.name === name);
  const open = zone?.tables[0]?.zoneOpen === false;
  try {
    await api('/api/admin/zones', {
      method: 'POST',
      body: JSON.stringify({ name, open }),
    });
    for (const table of state.data.tables) {
      if (table.zone === name) table.zoneOpen = open;
    }
    renderZoneToggles();
    renderPlan();
  } catch (err) {
    if (err.message !== 'auth') document.querySelector('#scheduleError').textContent = err.message;
  }
});

document.querySelector('#poolTimes').addEventListener('click', (event) => {
  const time = event.target.closest('[data-time]')?.dataset.time;
  if (!time) return;
  state.times = state.times.filter((item) => item !== time);
  renderPool();
});

document.querySelector('#poolBuild').onclick = async () => {
  document.querySelector('#scheduleError').textContent = '';
  try {
    const data = await api('/api/admin/schedule/pool', {
      method: 'POST',
      body: JSON.stringify({
        from: hhmm(document.querySelector('#poolFrom').value),
        to: hhmm(document.querySelector('#poolTo').value),
        step: Number(document.querySelector('#poolStep').value),
      }),
    });
    state.times = data.times;
    renderPool();
  } catch (err) {
    if (err.message !== 'auth') document.querySelector('#scheduleError').textContent = err.message;
  }
};

document.querySelector('#poolAddBtn').onclick = () => {
  const time = hhmm(document.querySelector('#poolAdd').value);
  document.querySelector('#scheduleError').textContent = time ? '' : 'Укажите время';
  if (!time || state.times.includes(time)) return;
  state.times = nightSort([...state.times, time]);
  renderPool();
};

document.querySelector('#poolSave').onclick = async () => {
  document.querySelector('#scheduleError').textContent = '';
  try {
    const data = await api('/api/admin/schedule', {
      method: 'POST',
      body: JSON.stringify({
        dateFrom: document.querySelector('#dateFrom').value,
        dateTo: document.querySelector('#dateTo').value,
        times: state.times,
      }),
    });
    applySchedule(data.schedule);
  } catch (err) {
    if (err.message !== 'auth') document.querySelector('#scheduleError').textContent = err.message;
  }
};

load().catch(() => showLogin());

const state = {
  date: '',
  time: '20:00',
  guests: 1,
  zone: '',
  tableId: null,
  floor: null,
};

const dateInput = document.querySelector('#date');
const timesEl = document.querySelector('#times');
const floorEl = document.querySelector('#floor');
const zonesEl = document.querySelector('#zones');
const pickEl = document.querySelector('#pick');
const bookBtn = document.querySelector('#book');
const guestCount = document.querySelector('#guestCount');
const sheet = document.querySelector('#sheet');

function seatWord(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'место';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'места';
  return 'мест';
}

function pips(seats, held, yours) {
  const html = [];
  for (let i = 0; i < seats; i += 1) {
    let cls = '';
    if (i < held) cls = 'taken';
    else if (i < held + yours) cls = 'yours';
    html.push(`<i class="pip ${cls}"></i>`);
  }
  return html.join('');
}

function applyDateBounds() {
  const today = state.floor?.today || state.date;
  const from = state.floor?.dateFrom || '';
  const to = state.floor?.dateTo || '';
  const min = from && from > today ? from : today;
  dateInput.min = min;
  dateInput.max = to || '';
  if (to && to < min) return false;
  let next = state.date;
  if (next < min) next = min;
  if (to && next > to) next = to;
  if (next === state.date) return false;
  state.date = next;
  dateInput.value = next;
  return true;
}

async function loadFloor() {
  const response = await fetch(`/api/floor?date=${state.date}&time=${state.time}`);
  state.floor = await response.json();
  if (applyDateBounds()) return loadFloor();
  const slots = state.floor.times || [];
  if (!slots.some((slot) => slot.time === state.time && slot.open)) {
    const next = slots.find((slot) => slot.open);
    if (next) {
      state.time = next.time;
      return loadFloor();
    }
  }
  if (!state.zone || !state.floor.zones.some((zone) => zone.name === state.zone)) {
    state.zone = state.floor.zones[0]?.name || '';
  }
  const stillThere = currentZone()?.tables.some((table) => table.id === state.tableId);
  if (!stillThere) state.tableId = null;
  render();
}

function currentZone() {
  return state.floor?.zones.find((zone) => zone.name === state.zone);
}

function selectedTable() {
  return currentZone()?.tables.find((table) => table.id === state.tableId) || null;
}

function renderTimes() {
  timesEl.innerHTML = (state.floor?.times || []).map((slot) =>
    `<button type="button" class="chip ${slot.time === state.time ? 'on' : ''}" data-time="${slot.time}" ${slot.open ? '' : 'disabled'}>${slot.time}</button>`
  ).join('');
}

function timeOpen() {
  return state.floor?.times?.find((slot) => slot.time === state.time)?.open !== false;
}

function renderSheet() {
  const table = selectedTable();
  if (!table) return;
  const free = Math.max(0, table.free);
  if (state.guests > free) state.guests = Math.max(1, free);
  guestCount.innerHTML = Array.from({ length: free }, (_, index) => {
    const count = index + 1;
    return `<option value="${count}"${count === state.guests ? ' selected' : ''}>${count} ${seatWord(count)}</option>`;
  }).join('');
  const price = Number(table.price) || 0;
  const total = state.guests * price;
  document.querySelector('#sheetHint').textContent =
    `${table.name} · свободно ${table.free} из ${table.seats}`;
  document.querySelector('#sheetTotal').textContent = price
    ? `${state.guests} × ${formatMoney(price)} = ${formatMoney(total)}`
    : 'Цену места ещё не указали';
}

function render() {
  const dateNote = document.querySelector('#dateNote');
  if (dateNote) dateNote.hidden = state.floor?.dateOpen !== false;
  renderTimes();
  const zones = state.floor?.zones || [];
  zonesEl.innerHTML = zones.map((zone) =>
    `<button type="button" class="chip zone ${zone.name === state.zone ? 'on' : ''}" data-zone="${zone.name}">${zone.name}</button>`
  ).join('');
  const zone = currentZone();
  if (!zone) {
    floorEl.replaceChildren();
    floorEl.style.height = '';
    floorEl.innerHTML = '<p class="note empty-hall">Сейчас ни один зал не открыт для брони.</p>';
    bookBtn.disabled = true;
    pickEl.innerHTML = '<p class="note">Выберите стол на схеме.</p>';
    return;
  }
  const stage = mountPlan(floorEl, zone);
  const panHint = document.querySelector('#panHint');
  if (panHint) panHint.hidden = floorEl.dataset.pan !== '1';
  stage.innerHTML = zone.tables.map((table) => {
    const full = table.bookable && table.free < 1;
    const selected = table.id === state.tableId;
    const cls = [
      'table',
      table.h <= 80 ? 'compact' : '',
      selected ? 'selected' : '',
      !table.bookable ? 'closed' : '',
      full ? 'short' : '',
    ].filter(Boolean).join(' ');
    const count = table.bookable ? `${table.free}<small>/${table.seats}</small>` : '—';
    const price = table.price ? `<span class="price">${formatMoney(table.price)}</span>` : '';
    const marks = table.price ? '' : `<span class="pips">${pips(table.seats, table.held, 0)}</span>`;
    const label = planLabel(table.name, stage.dataset.scale, table.w);
    return `<button type="button" class="${cls}" data-id="${table.id}" style="${placeTable(table)}" aria-label="${table.name}">
      <span class="name">${label}</span>
      <span class="count">${count}</span>
      ${price}
      ${marks}
    </button>`;
  }).join('');

  const table = selectedTable();
  const fits = table && table.bookable && table.free >= 1 && timeOpen();
  bookBtn.disabled = !fits;
  if (sheet.open) renderSheet();
  if (!table) {
    pickEl.innerHTML = '<p class="note">Выберите стол на схеме.</p>';
    return;
  }
  const priceLine = table.price
    ? `<p class="price-line">${formatMoney(table.price)} <span>за место</span></p>`
    : '<p class="note">Цену места ещё не указали.</p>';
  pickEl.innerHTML = `
    <div class="seats-big">${table.free}<span>свободно из ${table.seats}</span></div>
    <h2>${table.name}</h2>
    ${priceLine}
    <p class="note">${state.date.split('-').reverse().join('.')} · ${state.time}</p>
    <p class="pips" style="margin:10px 0">${pips(table.seats, table.held, 0)}</p>
    <p class="note">${fits ? 'Число мест выберете в заявке.' : 'Свободных мест нет.'}</p>
  `;
}

timesEl.addEventListener('click', (event) => {
  const time = event.target.closest('[data-time]')?.dataset.time;
  if (!time) return;
  state.time = time;
  loadFloor();
});

zonesEl.addEventListener('click', (event) => {
  const zone = event.target.closest('[data-zone]')?.dataset.zone;
  if (!zone) return;
  state.zone = zone;
  state.tableId = null;
  render();
});

floorEl.addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-id]')?.dataset.id);
  if (!id) return;
  const table = currentZone()?.tables.find((item) => item.id === id);
  if (!table?.bookable || table.free < 1) return;
  state.tableId = id;
  state.guests = 1;
  render();
});

guestCount.onchange = () => {
  state.guests = Number(guestCount.value) || 1;
  renderSheet();
};
dateInput.onchange = () => {
  state.date = dateInput.value;
  loadFloor();
};

bookBtn.onclick = () => {
  const table = selectedTable();
  if (!table || table.free < 1) return;
  state.guests = Math.min(Math.max(1, state.guests), table.free);
  document.querySelector('#formError').textContent = '';
  renderSheet();
  sheet.showModal();
};
document.querySelector('#closeSheet').onclick = () => sheet.close();

document.querySelector('#form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: state.date,
      time: state.time,
      tableId: state.tableId,
      guests: state.guests,
      name: form.name.value,
      phone: form.phone.value,
      comment: form.comment.value,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    document.querySelector('#formError').textContent = data.error || 'Не отправилось';
    return;
  }
  sheet.close();
  document.querySelector('#booking').classList.add('hide');
  document.querySelector('#success').classList.add('show');
  const sum = data.booking.seatPrice
    ? ` ${formatMoney(data.booking.total)}.`
    : '';
  document.querySelector('#successText').textContent =
    `${data.booking.table}, ${data.booking.guests} ${seatWord(data.booking.guests)} из ${data.booking.seats}.${sum} ${data.booking.date.split('-').reverse().join('.')} в ${data.booking.time}. Мы перезвоним, чтобы подтвердить бронь и оплату.`;
};

window.addEventListener('resize', () => {
  if (state.floor) render();
});

document.querySelector('#again').onclick = () => {
  document.querySelector('#success').classList.remove('show');
  document.querySelector('#booking').classList.remove('hide');
  state.tableId = null;
  loadFloor();
};

state.date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg' }).format(new Date());
dateInput.value = state.date;
dateInput.min = state.date;
const posterDay = '2026-11-14';
const poster = document.querySelector('#poster');
if (state.date > posterDay) poster.hidden = true;
document.querySelector('#posterDate').onclick = () => {
  state.date = posterDay;
  dateInput.value = posterDay;
  loadFloor();
  document.querySelector('#floor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
loadFloor();

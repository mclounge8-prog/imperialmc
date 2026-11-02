const state = {
  date: '',
  time: '20:00',
  guests: 2,
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
const guestLabel = document.querySelector('#guestLabel');
const sheet = document.querySelector('#sheet');

function guestWord(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'гость';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'гостя';
  return 'гостей';
}

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

async function loadFloor() {
  const response = await fetch(`/api/floor?date=${state.date}&time=${state.time}`);
  state.floor = await response.json();
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

function render() {
  guestLabel.textContent = `${state.guests} ${guestWord(state.guests)}`;
  renderTimes();
  const zones = state.floor?.zones || [];
  zonesEl.innerHTML = zones.map((zone) =>
    `<button type="button" class="chip zone ${zone.name === state.zone ? 'on' : ''}" data-zone="${zone.name}">${zone.name}</button>`
  ).join('');
  const zone = currentZone();
  if (!zone) {
    floorEl.innerHTML = '';
    return;
  }
  const stage = mountPlan(floorEl, zone);
  const panHint = document.querySelector('#panHint');
  if (panHint) panHint.hidden = floorEl.dataset.pan !== '1';
  stage.innerHTML = zone.tables.map((table) => {
    const short = table.bookable && table.free < state.guests;
    const selected = table.id === state.tableId;
    const cls = [
      'table',
      table.h <= 80 ? 'compact' : '',
      selected ? 'selected' : '',
      !table.bookable ? 'closed' : '',
      short ? 'short' : '',
    ].filter(Boolean).join(' ');
    const yours = selected ? Math.min(state.guests, table.free) : 0;
    const count = table.bookable ? `${table.free}<small>/${table.seats}</small>` : '—';
    return `<button type="button" class="${cls}" data-id="${table.id}" style="${placeTable(table)}">
      <span class="name">${table.name}</span>
      <span class="count">${count}</span>
      <span class="pips">${pips(table.seats, table.held, yours)}</span>
    </button>`;
  }).join('');

  const table = selectedTable();
  const fits = table && table.bookable && table.free >= state.guests && timeOpen();
  bookBtn.disabled = !fits;
  if (!table) {
    pickEl.innerHTML = '<p class="note">Выберите стол, где свободных мест не меньше компании.</p>';
    return;
  }
  pickEl.innerHTML = `
    <div class="seats-big">${table.seats}<span>${seatWord(table.seats)} за столом</span></div>
    <h2>${table.name}</h2>
    <p class="note">${state.date.split('-').reverse().join('.')} · ${state.time} · ${state.guests} ${guestWord(state.guests)}</p>
    <p class="pips" style="margin:10px 0">${pips(table.seats, table.held, fits ? state.guests : 0)}</p>
    <p class="note">${fits ? `Займёте ${state.guests} из ${table.free} свободных.` : `Свободно ${table.free} ${seatWord(table.free)} — для этой компании мало.`}</p>
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
  if (!table?.bookable || table.free < state.guests) return;
  state.tableId = id;
  render();
});

document.querySelector('#less').onclick = () => {
  state.guests = Math.max(1, state.guests - 1);
  render();
};
document.querySelector('#more').onclick = () => {
  state.guests = Math.min(12, state.guests + 1);
  render();
};
dateInput.onchange = () => {
  state.date = dateInput.value;
  loadFloor();
};

bookBtn.onclick = () => {
  const table = selectedTable();
  if (!table) return;
  document.querySelector('#sheetHint').textContent =
    `${table.name} · ${table.seats} ${seatWord(table.seats)} · придут ${state.guests} ${guestWord(state.guests)}`;
  document.querySelector('#formError').textContent = '';
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
  document.querySelector('#successText').textContent =
    `${data.booking.table}, ${data.booking.guests} ${guestWord(data.booking.guests)} из ${data.booking.seats} ${seatWord(data.booking.seats)}. ${data.booking.date.split('-').reverse().join('.')} в ${data.booking.time}. Мы перезвоним, чтобы подтвердить бронь и оплату.`;
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
loadFloor();

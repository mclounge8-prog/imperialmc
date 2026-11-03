import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { sendBookingAlert } from './lib/alerts.js';
import { applyFloorSync, cleanFloorItems } from './lib/floorSync.js';
import { canBook, seatsHeld, startMinutes } from './lib/holds.js';
import { buildTimePool, dateAllowed, sortTimes } from './lib/schedule.js';

const ROOT = new URL('.', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const HOLD_MINUTES = 120;
const SECRET = process.env.BOOKING_SECRET || randomBytes(24).toString('hex');
const ADMIN_PASSWORD = process.env.BOOKING_ADMIN_PASSWORD || '';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'booking.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY,
    zone TEXT NOT NULL,
    zone_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL,
    bookable INTEGER NOT NULL DEFAULT 1,
    pos_x INTEGER NOT NULL,
    pos_y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bounds_w INTEGER NOT NULL,
    bounds_h INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    table_id INTEGER NOT NULL,
    guests INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY,
    zone TEXT NOT NULL,
    zone_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL,
    pos_x INTEGER NOT NULL,
    pos_y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL
  );
`);

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}
if (!columnNames('tables').includes('seat_price')) {
  db.exec('ALTER TABLE tables ADD COLUMN seat_price INTEGER NOT NULL DEFAULT 0');
}
if (!columnNames('bookings').includes('seat_price')) {
  db.exec('ALTER TABLE bookings ADD COLUMN seat_price INTEGER NOT NULL DEFAULT 0');
}
if (!columnNames('tables').includes('zone_open')) {
  db.exec('ALTER TABLE tables ADD COLUMN zone_open INTEGER NOT NULL DEFAULT 1');
}

const floor = JSON.parse(readFileSync(join(ROOT, 'data', 'floor.json'), 'utf8'));
const existing = db.prepare('SELECT COUNT(*) AS n FROM tables').get().n;
if (!existing) {
  const insert = db.prepare(
    `INSERT INTO tables (id, zone, zone_order, name, seats, bookable, pos_x, pos_y, width, height, bounds_w, bounds_h, seat_price)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const zone of floor.zones) {
    for (const table of zone.tables) {
      insert.run(
        table.id,
        zone.name,
        zone.order,
        table.name,
        table.seats,
        table.x,
        table.y,
        table.w,
        table.h,
        zone.bounds.width,
        zone.bounds.height,
        Number.isInteger(table.price) ? table.price : 0
      );
    }
  }
}

const PLAN_CELL = 40;
const PLAN_W = 800;
const PLAN_H = 480;
const PLAN_SIZES = {
  small: [80, 80],
  medium: [120, 80],
  large: [160, 120],
};
db.prepare('UPDATE tables SET bounds_w = ?, bounds_h = ?').run(PLAN_W, PLAN_H);

function readSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
}

function getSchedule() {
  const stored = readSetting('times', null);
  const times = Array.isArray(stored) && stored.length ? sortTimes(stored) : sortTimes(floor.times);
  const dateFrom = String(readSetting('dateFrom', '') || '');
  const dateTo = String(readSetting('dateTo', '') || '');
  return {
    times: times.length ? times : sortTimes(floor.times),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : '',
  };
}

function cleanDate(value) {
  const text = String(value || '');
  if (!text) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function snapPlan(value, limit) {
  const n = Math.round(Number(value) / PLAN_CELL) * PLAN_CELL;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(limit, n));
}

function ekbParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    minutes: startMinutes(`${pick('hour')}:${pick('minute')}`),
  };
}

function slotStillOpen(date, time) {
  const now = ekbParts();
  if (date < now.date) return false;
  if (date > now.date) return true;
  const start = startMinutes(time);
  if (start == null || now.minutes == null) return false;
  return start + HOLD_MINUTES > now.minutes;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function signToken() {
  const body = Buffer.from(
    JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })
  ).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function adminOk(req) {
  const cookie = String(req.headers.cookie || '');
  const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('roza_booking='));
  if (!token) return false;
  const value = token.slice('roza_booking='.length);
  const [body, sig] = value.split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function setCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === '0' ? '' : '; Secure';
  res.setHeader(
    'Set-Cookie',
    `roza_booking=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`
  );
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', 'roza_booking=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function listBlocks() {
  return db.prepare(
    `SELECT id, zone, zone_order AS zoneOrder, name, seats,
            pos_x AS x, pos_y AS y, width AS w, height AS h
     FROM blocks ORDER BY zone_order, id`
  ).all();
}

function cleanBlocks(list) {
  return cleanFloorItems(list, { seatsMin: 0 });
}

function cleanTables(list) {
  return cleanFloorItems(list, { seatsMin: 1 });
}

function syncOk(req) {
  const file = join(DATA_DIR, 'sync.token');
  if (!existsSync(file)) return false;
  const expected = readFileSync(file, 'utf8').trim();
  const got = String(req.headers['x-sync-token'] || '');
  return expected.length > 0 && safeEqual(got, expected);
}

function listTables() {
  return db.prepare(
    `SELECT id, zone, zone_order AS zoneOrder, name, seats, bookable, zone_open AS zoneOpen, seat_price AS price,
            pos_x AS x, pos_y AS y, width AS w, height AS h,
            bounds_w AS boundsW, bounds_h AS boundsH
     FROM tables ORDER BY zone_order, name`
  ).all().map((row) => ({ ...row, bookable: !!row.bookable, zoneOpen: !!row.zoneOpen }));
}

function bookingNotice(id) {
  return db.prepare(
    `SELECT b.date, b.time, b.guests, b.name, b.phone, b.comment, b.status,
            b.seat_price AS seatPrice, t.name AS "table", t.zone, t.seats
     FROM bookings b JOIN tables t ON t.id = b.table_id
     WHERE b.id = ?`
  ).get(id);
}

function notifyBooking(kind, row) {
  if (!row || !TITLES_SENT.has(kind)) return;
  const file = join(DATA_DIR, 'telegram.json');
  let config = null;
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.botToken && data.chatId) {
        config = { botToken: String(data.botToken), chatId: String(data.chatId) };
      }
    } catch {
      config = null;
    }
  }
  void sendBookingAlert(kind, row, config).catch((err) => {
    console.error('booking alert', err.message);
  });
}

const TITLES_SENT = new Set(['new', 'reserved', 'paid', 'cancelled']);

function activeBookings() {
  return db.prepare(
    `SELECT id, date, time, table_id AS tableId, guests, status FROM bookings WHERE status != 'cancelled'`
  ).all();
}

function floorPayload(date, time) {
  const bookings = activeBookings();
  const tables = listTables().filter((table) => table.zoneOpen);
  const schedule = getSchedule();
  const dateOpen = dateAllowed(date, schedule.dateFrom, schedule.dateTo);
  const zones = [];
  for (const table of tables) {
    let zone = zones.find((item) => item.name === table.zone);
    if (!zone) {
      zone = {
        name: table.zone,
        order: table.zoneOrder,
        bounds: { width: table.boundsW, height: table.boundsH },
        tables: [],
        blocks: [],
      };
      zones.push(zone);
    }
    const held = seatsHeld(bookings, table.id, date, time, HOLD_MINUTES);
    const free = Math.max(0, table.seats - held);
    zone.tables.push({
      id: table.id,
      name: table.name,
      seats: table.seats,
      free,
      held,
      price: table.price,
      bookable: table.bookable,
      x: table.x,
      y: table.y,
      w: table.w,
      h: table.h,
    });
  }
  for (const block of listBlocks()) {
    const zone = zones.find((item) => item.name === block.zone);
    if (!zone) continue;
    zone.blocks.push({
      id: block.id,
      name: block.name,
      seats: block.seats,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
    });
  }
  zones.sort((a, b) => a.order - b.order);
  return {
    venue: floor.venue,
    address: floor.address,
    holdMinutes: HOLD_MINUTES,
    times: schedule.times.map((slot) => ({ time: slot, open: dateOpen && slotStillOpen(date, slot) })),
    today: ekbParts().date,
    dateFrom: schedule.dateFrom,
    dateTo: schedule.dateTo,
    dateOpen,
    zones,
  };
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((at) => now - at < 60 * 60 * 1000);
  if (recent.length >= 8) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.includes('\0') || rel.split('/').includes('..')) {
    json(res, 404, { error: 'Не найдено' });
    return;
  }
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(`${PUBLIC}/`) || !existsSync(file) || extname(file) === '') {
    json(res, 404, { error: 'Не найдено' });
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/api/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && (path === '/dashboard' || path === '/dashboard/')) {
      res.writeHead(302, { Location: '/dashboard.html' });
      res.end();
      return;
    }
    if (req.method === 'POST' && path === '/api/sync/blocks') {
      if (!syncOk(req)) {
        json(res, 401, { error: 'Нет доступа' });
        return;
      }
      const body = await readBody(req);
      const hasBlocks = Object.prototype.hasOwnProperty.call(body, 'blocks');
      const hasTables = Object.prototype.hasOwnProperty.call(body, 'tables');
      if (!hasBlocks && !hasTables) {
        json(res, 400, { error: 'Нет схемы зала' });
        return;
      }
      const blocks = hasBlocks ? cleanBlocks(body.blocks) : null;
      const tables = hasTables ? cleanTables(body.tables) : null;
      if ((hasBlocks && !blocks) || (hasTables && !tables)) {
        json(res, 400, { error: 'Некорректная схема зала' });
        return;
      }
      applyFloorSync(db, { blocks, tables });
      json(res, 200, { ok: true, blocks: blocks ? blocks.length : null, tables: tables ? tables.length : null });
      return;
    }
    if (req.method === 'GET' && path === '/api/floor') {
      const date = url.searchParams.get('date') || ekbParts().date;
      const time = url.searchParams.get('time') || '20:00';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || startMinutes(time) == null) {
        json(res, 400, { error: 'Некорректные дата или время' });
        return;
      }
      json(res, 200, floorPayload(date, time));
      return;
    }
    if (req.method === 'POST' && path === '/api/bookings') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
      if (limited(ip)) {
        json(res, 429, { error: 'Слишком много заявок. Напишите нам чуть позже.' });
        return;
      }
      const body = await readBody(req);
      const date = String(body.date || '');
      const time = String(body.time || '');
      const tableId = Number(body.tableId);
      const guests = Number(body.guests);
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      const phone = digits(body.phone);
      const comment = String(body.comment || '').trim().slice(0, 400);
      const schedule = getSchedule();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dateAllowed(date, schedule.dateFrom, schedule.dateTo)) {
        json(res, 400, { error: 'На эту дату бронь не открыта' });
        return;
      }
      if (!schedule.times.includes(time)) {
        json(res, 400, { error: 'Выберите время из списка' });
        return;
      }
      if (!slotStillOpen(date, time)) {
        json(res, 409, { error: 'Это время уже прошло' });
        return;
      }
      if (name.length < 2 || name.length > 80) {
        json(res, 400, { error: 'Как к вам обращаться?' });
        return;
      }
      if (phone.length < 10 || phone.length > 15) {
        json(res, 400, { error: 'Нужен телефон, чтобы подтвердить бронь' });
        return;
      }
      db.exec('BEGIN IMMEDIATE');
      let created;
      try {
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
        if (!table || !table.zone_open) {
          db.exec('ROLLBACK');
          json(res, table ? 409 : 404, {
            error: table ? 'Этот зал сейчас не бронируется' : 'Такого стола нет',
          });
          return;
        }
        const held = seatsHeld(activeBookings(), table.id, date, time, HOLD_MINUTES);
        const verdict = canBook({
          seats: table.seats,
          held,
          guests,
          bookable: !!table.bookable,
        });
        if (!verdict.ok) {
          db.exec('ROLLBACK');
          const message = verdict.reason === 'full'
            ? `Свободно только ${verdict.free} из ${table.seats}`
            : verdict.reason === 'closed'
              ? 'Этот стол сейчас не бронируется'
              : 'Гостей больше, чем мест за столом';
          json(res, 409, { error: message, free: verdict.free, seats: table.seats });
          return;
        }
        const seatPrice = Number(table.seat_price) || 0;
        created = db.prepare(
          `INSERT INTO bookings (created_at, date, time, table_id, guests, name, phone, comment, status, seat_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
        ).run(new Date().toISOString(), date, time, table.id, guests, name, phone, comment, seatPrice);
        db.exec('COMMIT');
        notifyBooking('new', bookingNotice(Number(created.lastInsertRowid)));
        json(res, 201, {
        booking: {
          id: Number(created.lastInsertRowid),
          date,
          time,
          table: table.name,
          zone: table.zone,
          guests,
          seats: table.seats,
          seatPrice,
          total: guests * seatPrice,
          status: 'new',
        },
      });
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* already closed */ }
        throw err;
      }
      return;
    }

    if (path.startsWith('/api/admin')) {
      if (req.method === 'POST' && path === '/api/admin/login') {
        const body = await readBody(req);
        if (!ADMIN_PASSWORD || !safeEqual(body.password || '', ADMIN_PASSWORD)) {
          json(res, 401, { error: 'Неверный пароль' });
          return;
        }
        setCookie(res, signToken());
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && path === '/api/admin/logout') {
        clearCookie(res);
        json(res, 200, { ok: true });
        return;
      }
      if (!adminOk(req)) {
        json(res, 401, { error: 'Нужен вход' });
        return;
      }
      if (req.method === 'GET' && path === '/api/admin/bookings') {
        const rows = db.prepare(
          `SELECT b.id, b.created_at AS createdAt, b.date, b.time, b.guests, b.name, b.phone,
                  b.comment, b.status, b.seat_price AS seatPrice, t.name AS tableName, t.zone, t.seats
           FROM bookings b JOIN tables t ON t.id = b.table_id
           ORDER BY CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END,
                    b.date,
                    CASE WHEN b.time < '06:00' THEN 1 ELSE 0 END,
                    b.time,
                    b.id`
        ).all();
        json(res, 200, { bookings: rows, tables: listTables(), blocks: listBlocks(), schedule: getSchedule() });
        return;
      }
      if (req.method === 'POST' && path === '/api/admin/schedule/pool') {
        const body = await readBody(req);
        const built = buildTimePool({ from: body.from, to: body.to, step: Number(body.step) });
        if (!built.ok) {
          const message = built.reason === 'step'
            ? 'Шаг — от 5 до 180 минут'
            : built.reason === 'long'
              ? 'Слишком плотный пул. Увеличьте шаг'
              : 'Укажите время с и до';
          json(res, 400, { error: message });
          return;
        }
        json(res, 200, { times: built.times });
        return;
      }
      if (req.method === 'POST' && path === '/api/admin/schedule') {
        const body = await readBody(req);
        const dateFrom = cleanDate(body.dateFrom);
        const dateTo = cleanDate(body.dateTo);
        const times = sortTimes(Array.isArray(body.times) ? body.times : []);
        if (dateFrom == null || dateTo == null) {
          json(res, 400, { error: 'Дата указана неверно' });
          return;
        }
        if (dateFrom && dateTo && dateFrom > dateTo) {
          json(res, 400, { error: 'Дата «с» позже даты «по»' });
          return;
        }
        if (!times.length || times.length > 96) {
          json(res, 400, { error: 'В пуле нужно от 1 до 96 времён' });
          return;
        }
        writeSetting('dateFrom', dateFrom);
        writeSetting('dateTo', dateTo);
        writeSetting('times', times);
        json(res, 200, { schedule: getSchedule() });
        return;
      }
      if (req.method === 'POST' && path === '/api/admin/zones') {
        const body = await readBody(req);
        const name = String(body.name || '');
        const open = body.open ? 1 : 0;
        const updated = db.prepare('UPDATE tables SET zone_open = ? WHERE zone = ?').run(open, name);
        if (!updated.changes) {
          json(res, 404, { error: 'Такого зала нет' });
          return;
        }
        json(res, 200, { ok: true });
        return;
      }
      const statusMatch = path.match(/^\/api\/admin\/bookings\/(\d+)\/status$/);
      if (req.method === 'POST' && statusMatch) {
        const body = await readBody(req);
        const status = String(body.status || '');
        if (!['new', 'reserved', 'paid', 'cancelled'].includes(status)) {
          json(res, 400, { error: 'Неизвестный статус' });
          return;
        }
        const current = bookingNotice(Number(statusMatch[1]));
        if (!current) {
          json(res, 404, { error: 'Заявка не найдена' });
          return;
        }
        if (current.status !== status) {
          db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, Number(statusMatch[1]));
          notifyBooking(status, current);
        }
        json(res, 200, { ok: true });
        return;
      }
      const seatsMatch = path.match(/^\/api\/admin\/tables\/(\d+)$/);
      if (req.method === 'POST' && seatsMatch) {
        const body = await readBody(req);
        const current = db.prepare('SELECT * FROM tables WHERE id = ?').get(Number(seatsMatch[1]));
        if (!current) {
          json(res, 404, { error: 'Стол не найден' });
          return;
        }
        let seats = current.seats;
        let bookable = current.bookable;
        let price = current.seat_price;
        let x = current.pos_x;
        let y = current.pos_y;
        let width = current.width;
        let height = current.height;
        if (body.price != null) {
          price = Number(body.price);
          if (!Number.isInteger(price) || price < 0 || price > 1_000_000) {
            json(res, 400, { error: 'Цена места — целое число рублей, до 1 000 000' });
            return;
          }
        }
        if (body.seats != null || body.bookable != null) {
          seats = Number(body.seats);
          bookable = body.bookable ? 1 : 0;
          if (!Number.isInteger(seats) || seats < 1 || seats > 30) {
            json(res, 400, { error: 'Мест может быть от 1 до 30' });
            return;
          }
        }
        if (body.size != null) {
          const dims = PLAN_SIZES[body.size];
          if (!dims) {
            json(res, 400, { error: 'Неизвестный размер стола' });
            return;
          }
          [width, height] = dims;
        }
        if (body.x != null || body.y != null) {
          x = snapPlan(body.x ?? x, PLAN_W - width);
          y = snapPlan(body.y ?? y, PLAN_H - height);
          if (x == null || y == null) {
            json(res, 400, { error: 'Некорректное место на схеме' });
            return;
          }
        } else if (body.size != null) {
          x = Math.min(x, PLAN_W - width);
          y = Math.min(y, PLAN_H - height);
        }
        db.prepare(
          'UPDATE tables SET seats = ?, bookable = ?, seat_price = ?, pos_x = ?, pos_y = ?, width = ?, height = ? WHERE id = ?'
        ).run(seats, bookable, price, x, y, width, height, current.id);
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { error: 'Не найдено' });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, path);
      return;
    }
    json(res, 405, { error: 'Метод не поддерживается' });
  } catch (err) {
    if (err?.message === 'bad_json') {
      json(res, 400, { error: 'Некорректный запрос' });
      return;
    }
    console.error(err);
    json(res, 500, { error: 'Не получилось сохранить заявку' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MC Lounge Роза booking on :${PORT}`);
});

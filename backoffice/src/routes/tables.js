import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderZonesList,
  renderTableTile,
  renderTableEditTile,
  renderBlockTile,
  renderBlockEditTile,
  renderFloorPlan,
  renderVenueZonesAndFloorPlan,
} from '../views/tablesView.js';
import {
  clampTablePosition,
  dimensionsForSize,
  FLOOR_PLAN_HEIGHT,
  FLOOR_PLAN_WIDTH,
  GRID_CELL,
  normalizeTableSizeKey,
  TABLE_SIZE_VALUES,
  withTableDimensions,
} from '../tableSizes.js';

const tables = new Hono();
tables.use('*', requireAuthApi);

const STATUS_VALUES = ['free', 'occupied', 'dirty'];
const ROSA_VENUE_ID = 1;
const SYNC_TOKEN_PATH = process.env.BOOKING_SYNC_TOKEN_FILE || '/app/booking-sync.token';
const SYNC_URL = process.env.BOOKING_SYNC_URL || 'http://mcl-roze-booking:3000/api/sync/blocks';

let blocksReady = null;
function ensureBlocks() {
  if (!blocksReady) {
    blocksReady = pool.query(`
      CREATE TABLE IF NOT EXISTS floor_blocks (
        id SERIAL PRIMARY KEY,
        zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL DEFAULT '',
        seats INTEGER NOT NULL DEFAULT 0,
        pos_x INTEGER NOT NULL DEFAULT 0,
        pos_y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 160,
        height INTEGER NOT NULL DEFAULT 80
      )
    `).catch((err) => {
      blocksReady = null;
      throw err;
    });
  }
  return blocksReady;
}

async function fetchBlocks(zoneId) {
  await ensureBlocks();
  const { rows } = await pool.query(
    `SELECT id, zone_id, name, seats, pos_x, pos_y, width, height
     FROM floor_blocks WHERE zone_id = $1 ORDER BY id`,
    [zoneId]
  );
  return rows;
}

function blockSize(body) {
  const cols = Math.round(Number(body.cols));
  const rows = Math.round(Number(body.rows));
  if (!Number.isInteger(cols) || cols < 1 || cols > 16) return null;
  if (!Number.isInteger(rows) || rows < 1 || rows > 10) return null;
  const width = cols * GRID_CELL;
  const height = rows * GRID_CELL;
  if (width > FLOOR_PLAN_WIDTH || height > FLOOR_PLAN_HEIGHT) return null;
  return { width, height };
}

function blockSeats(value) {
  if (value === '' || value == null) return 0;
  const seats = Math.round(Number(value));
  if (!Number.isInteger(seats) || seats < 0 || seats > 99) return null;
  return seats;
}

async function fetchBlock(id) {
  await ensureBlocks();
  const { rows } = await pool.query(
    'SELECT id, zone_id, name, seats, pos_x, pos_y, width, height FROM floor_blocks WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function pushRosaBlocks() {
  try {
    if (!existsSync(SYNC_TOKEN_PATH)) return;
    const token = readFileSync(SYNC_TOKEN_PATH, 'utf8').trim();
    if (!token) return;
    await ensureBlocks();
    const { rows } = await pool.query(
      `SELECT b.id, z.name AS zone, z.sort_order AS zone_order, b.name, b.seats,
              b.pos_x AS x, b.pos_y AS y, b.width AS w, b.height AS h
       FROM floor_blocks b
       JOIN zones z ON z.id = b.zone_id
       WHERE z.venue_id = $1 AND z.name NOT IN ('Начальство', 'Офис')
       ORDER BY z.sort_order, b.id`,
      [ROSA_VENUE_ID]
    );
    await fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({
        blocks: rows.map((row) => ({
          id: row.id,
          zone: row.zone,
          zoneOrder: row.zone_order,
          name: row.name,
          seats: row.seats,
          x: row.x,
          y: row.y,
          w: row.w,
          h: row.h,
        })),
      }),
    });
  } catch {
    // Схема в бэкофисе сохраняется, даже если сайт брони сейчас недоступен.
  }
}
const TABLE_SELECT =
  'SELECT id, zone_id, name, capacity, pos_x, pos_y, width, height, size, status FROM tables';
const ZONE_ORDER = 'ORDER BY sort_order ASC, id ASC';

async function fetchZonesForVenue(venueId) {
  const { rows } = await pool.query(
    `SELECT id, name, sort_order FROM zones WHERE venue_id = $1 ${ZONE_ORDER}`,
    [venueId]
  );
  return rows;
}

async function fetchTable(id) {
  const { rows } = await pool.query(`${TABLE_SELECT} WHERE id = $1`, [id]);
  return rows[0] ? withTableDimensions(rows[0]) : null;
}

async function fetchZonesAndFirstFloorPlan(venueId) {
  const zones = await fetchZonesForVenue(venueId);
  const selectedZone = zones[0] || null;
  let tableRows = [];
  if (selectedZone) {
    const { rows } = await pool.query(`${TABLE_SELECT} WHERE zone_id = $1 ORDER BY id`, [
      selectedZone.id,
    ]);
    tableRows = rows.map(withTableDimensions);
  }
  return { zones, selectedZone, tableRows, blockRows: selectedZone ? await fetchBlocks(selectedZone.id) : [] };
}

// ---------- Переключение заведения ----------

tables.get('/venue-view', async (c) => {
  const venueId = c.req.query('venueId');
  const { zones, selectedZone, tableRows, blockRows } = await fetchZonesAndFirstFloorPlan(venueId);
  return c.html(renderVenueZonesAndFloorPlan(venueId, zones, selectedZone, tableRows, blockRows));
});

// ---------- Зоны ----------

tables.post('/venues/:venueId/zones', async (c) => {
  const venueId = c.req.param('venueId');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  if (!name) {
    const zones = await fetchZonesForVenue(venueId);
    return c.html(
      `${renderZonesList(zones)}<div id="zone-form-error" class="error" hx-swap-oob="true">Укажи название зоны</div>`
    );
  }

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM zones WHERE venue_id = $1',
    [venueId]
  );
  const nextOrder = Number(maxRows[0]?.next_order ?? 0);

  await pool.query(
    'INSERT INTO zones (venue_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, sort_order',
    [venueId, name, nextOrder]
  );
  const zones = await fetchZonesForVenue(venueId);
  return c.html(renderZonesList(zones));
});

tables.post('/zones/:id/move', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const dir = String(body.dir || '') === 'up' ? -1 : 1;

  const { rows } = await pool.query('SELECT id, venue_id, sort_order FROM zones WHERE id = $1', [id]);
  const zone = rows[0];
  if (!zone) {
    c.status(404);
    return c.html('<p class="error">Зона не найдена</p>');
  }

  const zones = await fetchZonesForVenue(zone.venue_id);
  const index = zones.findIndex((z) => z.id === zone.id);
  const swapIndex = index + dir;
  if (index < 0 || swapIndex < 0 || swapIndex >= zones.length) {
    return c.html(renderZonesList(zones));
  }

  const other = zones[swapIndex];
  await pool.query('UPDATE zones SET sort_order = $1 WHERE id = $2', [other.sort_order, zone.id]);
  await pool.query('UPDATE zones SET sort_order = $1 WHERE id = $2', [zone.sort_order, other.id]);

  // Плотные номера 0..n-1 после обмена
  const refreshed = await fetchZonesForVenue(zone.venue_id);
  for (let i = 0; i < refreshed.length; i += 1) {
    if (refreshed[i].sort_order !== i) {
      await pool.query('UPDATE zones SET sort_order = $1 WHERE id = $2', [i, refreshed[i].id]);
      refreshed[i].sort_order = i;
    }
  }

  return c.html(renderZonesList(refreshed));
});

tables.delete('/zones/:id', async (c) => {
  await pool.query('DELETE FROM zones WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

tables.get('/zones/:id/floor-plan', async (c) => {
  const zoneId = c.req.param('id');
  const { rows: zoneRows } = await pool.query('SELECT id, name FROM zones WHERE id = $1', [
    zoneId,
  ]);
  const zone = zoneRows[0];

  if (!zone) {
    c.status(404);
    return c.html('<p class="empty-hint">Зона не найдена</p>');
  }

  const { rows: tableRows } = await pool.query(`${TABLE_SELECT} WHERE zone_id = $1 ORDER BY id`, [
    zoneId,
  ]);
  const blockRows = await fetchBlocks(zoneId);

  return c.html(renderFloorPlan(zone, tableRows.map(withTableDimensions), blockRows));
});

// ---------- Столы ----------

tables.post('/zones/:zoneId/tables', async (c) => {
  const zoneId = c.req.param('zoneId');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const capacity = body.capacity ? Number(body.capacity) : 4;
  const size = normalizeTableSizeKey(body.size);
  const { width, height } = dimensionsForSize(size);

  if (!name) return c.html('<p>Укажи название стола</p>');
  if (Number.isNaN(capacity) || capacity < 1) {
    return c.html('<p>Вместимость должна быть числом ≥ 1</p>');
  }

  const { posX, posY } = clampTablePosition(
    GRID_CELL + Math.floor(Math.random() * 8) * GRID_CELL,
    GRID_CELL + Math.floor(Math.random() * 5) * GRID_CELL,
    width,
    height
  );

  const { rows } = await pool.query(
    `INSERT INTO tables (zone_id, name, capacity, pos_x, pos_y, width, height, size, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'free') RETURNING id`,
    [zoneId, name, capacity, posX, posY, width, height, size]
  );

  const created = await fetchTable(rows[0].id);
  return c.html(renderTableTile(created, { oob: true, zoneId }));
});

tables.get('/:id/edit', async (c) => {
  const table = await fetchTable(c.req.param('id'));
  if (!table) {
    c.status(404);
    return c.text('Стол не найден');
  }
  return c.html(renderTableEditTile(table));
});

tables.get('/:id/view', async (c) => {
  const table = await fetchTable(c.req.param('id'));
  if (!table) {
    c.status(404);
    return c.text('Стол не найден');
  }
  return c.html(renderTableTile(table));
});

tables.post('/zones/:zoneId/blocks', async (c) => {
  const zoneId = c.req.param('zoneId');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim().slice(0, 50);
  const seats = blockSeats(body.seats);
  const size = blockSize(body);
  if (seats == null) return c.html('<p>Мест — число от 0 до 99</p>');
  if (!size) return c.html('<p>Размер — от 1×1 до 16×10 клеток</p>');

  const { posX, posY } = clampTablePosition(
    GRID_CELL + Math.floor(Math.random() * 6) * GRID_CELL,
    GRID_CELL + Math.floor(Math.random() * 4) * GRID_CELL,
    size.width,
    size.height
  );
  await ensureBlocks();
  const { rows } = await pool.query(
    `INSERT INTO floor_blocks (zone_id, name, seats, pos_x, pos_y, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [zoneId, name, seats, posX, posY, size.width, size.height]
  );
  const created = await fetchBlock(rows[0].id);
  await pushRosaBlocks();
  return c.html(renderBlockTile(created, { oob: true, zoneId }));
});

tables.get('/blocks/:id/edit', async (c) => {
  const block = await fetchBlock(c.req.param('id'));
  if (!block) {
    c.status(404);
    return c.text('Прямоугольник не найден');
  }
  return c.html(renderBlockEditTile(block));
});

tables.get('/blocks/:id/view', async (c) => {
  const block = await fetchBlock(c.req.param('id'));
  if (!block) {
    c.status(404);
    return c.text('Прямоугольник не найден');
  }
  return c.html(renderBlockTile(block));
});

tables.put('/blocks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const current = await fetchBlock(id);
  if (!current) {
    c.status(404);
    return c.text('Прямоугольник не найден');
  }
  const name = String(body.name || '').trim().slice(0, 50);
  const seats = blockSeats(body.seats);
  const size = blockSize(body);
  if (seats == null) return c.html(renderBlockEditTile({ ...current, name }, 'Мест — число от 0 до 99'));
  if (!size) return c.html(renderBlockEditTile({ ...current, name, seats }, 'Размер — от 1×1 до 16×10 клеток'));
  const clamped = clampTablePosition(current.pos_x, current.pos_y, size.width, size.height);
  await pool.query(
    'UPDATE floor_blocks SET name = $1, seats = $2, width = $3, height = $4, pos_x = $5, pos_y = $6 WHERE id = $7',
    [name, seats, size.width, size.height, clamped.posX, clamped.posY, id]
  );
  const updated = await fetchBlock(id);
  await pushRosaBlocks();
  return c.html(renderBlockTile(updated));
});

tables.put('/blocks/:id/position', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const rawX = Math.round(Number(body.pos_x));
  const rawY = Math.round(Number(body.pos_y));
  if (Number.isNaN(rawX) || Number.isNaN(rawY)) {
    c.status(400);
    return c.body(null);
  }
  const current = await fetchBlock(id);
  if (!current) {
    c.status(404);
    return c.body(null);
  }
  const { posX, posY } = clampTablePosition(rawX, rawY, current.width, current.height);
  await pool.query('UPDATE floor_blocks SET pos_x = $1, pos_y = $2 WHERE id = $3', [posX, posY, id]);
  await pushRosaBlocks();
  return c.body(null);
});

tables.delete('/blocks/:id', async (c) => {
  await ensureBlocks();
  await pool.query('DELETE FROM floor_blocks WHERE id = $1', [c.req.param('id')]);
  await pushRosaBlocks();
  return c.body(null);
});

tables.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const capacity = Number(body.capacity);
  const status = String(body.status || '');
  const size = normalizeTableSizeKey(body.size);
  const { width, height } = dimensionsForSize(size);

  const current = await fetchTable(id);
  if (!current) {
    c.status(404);
    return c.text('Стол не найден');
  }

  if (!name) {
    return c.html(renderTableEditTile({ ...current }, 'Укажи название'));
  }
  if (Number.isNaN(capacity) || capacity < 1) {
    return c.html(renderTableEditTile({ ...current, name }, 'Вместимость должна быть числом ≥ 1'));
  }
  if (!STATUS_VALUES.includes(status)) {
    return c.html(renderTableEditTile({ ...current, name, capacity }, 'Некорректный статус'));
  }
  if (!TABLE_SIZE_VALUES.includes(size)) {
    return c.html(renderTableEditTile({ ...current, name, capacity, status }, 'Некорректный размер'));
  }

  const clamped = clampTablePosition(current.pos_x, current.pos_y, width, height);

  await pool.query(
    'UPDATE tables SET name = $1, capacity = $2, status = $3, width = $4, height = $5, size = $6, pos_x = $7, pos_y = $8 WHERE id = $9',
    [name, capacity, status, width, height, size, clamped.posX, clamped.posY, id]
  );

  const updated = await fetchTable(id);
  return c.html(renderTableTile(updated));
});

// Отдельный лёгкий эндпоинт под драг-н-дроп — вызывается напрямую через htmx.ajax
tables.put('/:id/position', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const rawX = Math.round(Number(body.pos_x));
  const rawY = Math.round(Number(body.pos_y));

  if (Number.isNaN(rawX) || Number.isNaN(rawY)) {
    c.status(400);
    return c.body(null);
  }

  const current = await fetchTable(id);
  if (!current) {
    c.status(404);
    return c.body(null);
  }

  const { posX, posY } = clampTablePosition(rawX, rawY, current.width, current.height);
  await pool.query('UPDATE tables SET pos_x = $1, pos_y = $2 WHERE id = $3', [posX, posY, id]);
  return c.body(null);
});

tables.delete('/:id', async (c) => {
  await pool.query('DELETE FROM tables WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

export default tables;

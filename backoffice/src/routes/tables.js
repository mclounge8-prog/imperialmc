import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderZoneRow,
  renderZonesList,
  renderTableTile,
  renderTableEditTile,
  renderFloorPlan,
  renderVenueZonesAndFloorPlan,
} from '../views/tablesView.js';
import {
  clampTablePosition,
  dimensionsForSize,
  GRID_CELL,
  normalizeTableSizeKey,
  TABLE_SIZE_VALUES,
  withTableDimensions,
} from '../tableSizes.js';

const tables = new Hono();
tables.use('*', requireAuthApi);

const STATUS_VALUES = ['free', 'occupied', 'dirty'];
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
  return { zones, selectedZone, tableRows };
}

// ---------- Переключение заведения ----------

tables.get('/venue-view', async (c) => {
  const venueId = c.req.query('venueId');
  const { zones, selectedZone, tableRows } = await fetchZonesAndFirstFloorPlan(venueId);
  return c.html(renderVenueZonesAndFloorPlan(venueId, zones, selectedZone, tableRows));
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

  return c.html(renderFloorPlan(zone, tableRows.map(withTableDimensions)));
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

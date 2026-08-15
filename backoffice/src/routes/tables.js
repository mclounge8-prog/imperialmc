import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderZoneRow,
  renderTableTile,
  renderTableEditTile,
  renderFloorPlan,
  renderVenueZonesAndFloorPlan,
} from '../views/tablesView.js';
import {
  dimensionsForSize,
  normalizeTableSizeKey,
  TABLE_SIZE_VALUES,
  withTableDimensions,
} from '../tableSizes.js';

const tables = new Hono();
tables.use('*', requireAuthApi);

const STATUS_VALUES = ['free', 'occupied', 'dirty'];
const TABLE_SELECT =
  'SELECT id, zone_id, name, capacity, pos_x, pos_y, width, height, size, status FROM tables';

async function fetchTable(id) {
  const { rows } = await pool.query(`${TABLE_SELECT} WHERE id = $1`, [id]);
  return rows[0] ? withTableDimensions(rows[0]) : null;
}

async function fetchZonesAndFirstFloorPlan(venueId) {
  const { rows: zones } = await pool.query(
    'SELECT id, name FROM zones WHERE venue_id = $1 ORDER BY name',
    [venueId]
  );
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
  if (!name) return c.html('<p>Укажи название зоны</p>');

  const { rows } = await pool.query(
    'INSERT INTO zones (venue_id, name) VALUES ($1, $2) RETURNING id, name',
    [venueId, name]
  );
  return c.html(renderZoneRow(rows[0], { oob: true }));
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

  const posX = 20 + Math.floor(Math.random() * 300);
  const posY = 20 + Math.floor(Math.random() * 200);

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

  await pool.query(
    'UPDATE tables SET name = $1, capacity = $2, status = $3, width = $4, height = $5, size = $6 WHERE id = $7',
    [name, capacity, status, width, height, size, id]
  );

  const updated = await fetchTable(id);
  return c.html(renderTableTile(updated));
});

// Отдельный лёгкий эндпоинт под драг-н-дроп — вызывается напрямую через htmx.ajax
tables.put('/:id/position', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const posX = Math.round(Number(body.pos_x));
  const posY = Math.round(Number(body.pos_y));

  if (Number.isNaN(posX) || Number.isNaN(posY)) {
    c.status(400);
    return c.body(null);
  }

  await pool.query('UPDATE tables SET pos_x = $1, pos_y = $2 WHERE id = $3', [posX, posY, id]);
  return c.body(null);
});

tables.delete('/:id', async (c) => {
  await pool.query('DELETE FROM tables WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

export default tables;

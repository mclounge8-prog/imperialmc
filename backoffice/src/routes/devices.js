import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { renderDeviceRow, renderRegistrationCode } from '../views/devicesView.js';

const devices = new Hono();
devices.use('*', requireAuthApi);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без O/0 и I/1 — легче диктовать/вводить
const CODE_LENGTH = 6;
const CODE_TTL_MS = 15 * 60 * 1000; // 15 минут

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function fetchVenuesList() {
  const { rows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  return rows;
}

async function fetchDevice(id) {
  const { rows } = await pool.query(
    'SELECT id, name, venue_id, is_active, last_seen_at FROM devices WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

devices.post('/generate-code', async (c) => {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query('INSERT INTO device_registration_codes (code, expires_at) VALUES ($1, $2)', [
    code,
    expiresAt,
  ]);

  return c.html(renderRegistrationCode(code, expiresAt));
});

devices.put('/:id/name', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();

  await pool.query('UPDATE devices SET name = $1 WHERE id = $2', [name || null, id]);

  const device = await fetchDevice(id);
  const venues = await fetchVenuesList();
  return c.html(renderDeviceRow(device, venues));
});

devices.put('/:id/venue', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const venueId = body.venue_id ? Number(body.venue_id) : null;

  await pool.query('UPDATE devices SET venue_id = $1 WHERE id = $2', [venueId, id]);

  const device = await fetchDevice(id);
  const venues = await fetchVenuesList();
  return c.html(renderDeviceRow(device, venues));
});

devices.post('/:id/toggle-active', async (c) => {
  const id = c.req.param('id');
  await pool.query('UPDATE devices SET is_active = NOT is_active WHERE id = $1', [id]);

  const device = await fetchDevice(id);
  const venues = await fetchVenuesList();
  return c.html(renderDeviceRow(device, venues));
});

devices.delete('/:id', async (c) => {
  await pool.query('DELETE FROM devices WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

export default devices;

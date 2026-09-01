import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { requireDeviceToken } from '../middleware/deviceAuth.js';

const apiDevices = new Hono();

function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Регистрация нового устройства по одноразовому коду из бэкофиса.
// Без авторизации по замыслу: у устройства на этом этапе ещё нет токена.
apiDevices.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const code = body && typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';

  if (!code) {
    c.status(400);
    return c.json({ error: 'Укажи код регистрации' });
  }

  const { rows } = await pool.query(
    'SELECT code, expires_at, used_at FROM device_registration_codes WHERE code = $1',
    [code]
  );
  const record = rows[0];

  if (!record) {
    c.status(404);
    return c.json({ error: 'Код не найден' });
  }
  if (record.used_at) {
    c.status(409);
    return c.json({ error: 'Код уже использован' });
  }
  if (new Date(record.expires_at) < new Date()) {
    c.status(410);
    return c.json({ error: 'Код истёк, сгенерируй новый в бэкофисе' });
  }

  const token = generateDeviceToken();
  const tokenHash = await bcrypt.hash(token, 10);

  await pool.query('INSERT INTO devices (token_hash) VALUES ($1)', [tokenHash]);
  await pool.query('UPDATE device_registration_codes SET used_at = now() WHERE code = $1', [code]);

  return c.json({ token });
});

// Проверка статуса устройства: активно ли, на какое заведение назначено.
// Терминал вызывает это при каждом запуске — так деактивация/переназначение
// из бэкофиса подхватываются без переустановки приложения.
apiDevices.get('/me', requireDeviceToken, async (c) => {
  const device = c.get('device');

  await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);

  let venue = null;
  if (device.venue_id) {
    const { rows } = await pool.query('SELECT id, name, COALESCE(precheck_enabled, false) AS precheck_enabled FROM venues WHERE id = $1', [
      device.venue_id,
    ]);
    venue = rows[0]
      ? {
          id: rows[0].id,
          name: rows[0].name,
          precheckEnabled: !!rows[0].precheck_enabled,
        }
      : null;
  }

  return c.json({ active: device.is_active, venue });
});

export default apiDevices;

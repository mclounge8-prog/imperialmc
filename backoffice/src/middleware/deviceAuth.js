import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

export async function findDeviceByToken(token) {
  const { rows } = await pool.query('SELECT id, venue_id, is_active, token_hash FROM devices');
  for (const device of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(token, device.token_hash)) {
      return device;
    }
  }
  return null;
}

/** Проверяет только валидность самого токена — не активность и не назначение на
 * заведение, потому что /me должен уметь ответить "деактивировано"/"не назначено",
 * а не просто отказать. Каждый роут сам решает, что делать со статусом устройства. */
export async function requireDeviceToken(c, next) {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    c.status(401);
    return c.json({ error: 'Устройство не авторизовано' });
  }

  const device = await findDeviceByToken(token);
  if (!device) {
    c.status(401);
    return c.json({ error: 'Устройство не найдено — возможно, было удалено в бэкофисе' });
  }

  c.set('device', device);
  await next();
}

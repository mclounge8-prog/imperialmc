import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../db.js';
import { requireDeviceToken } from '../middleware/deviceAuth.js';

const apiStaffAuth = new Hono();

const SESSION_TTL_SECONDS = 60 * 60 * 14; // 14 часов — смена с запасом

// Вход по PIN требует токен устройства (Authorization) — так вход возможен
// только сотрудниками, назначенными именно на заведение ЭТОГО устройства,
// а не любым активным сотрудником компании.
apiStaffAuth.post('/login', requireDeviceToken, async (c) => {
  const device = c.get('device');

  if (!device.is_active || !device.venue_id) {
    c.status(403);
    return c.json({ error: 'Устройство недоступно для входа — обратись к администратору' });
  }

  const body = await c.req.json().catch(() => null);
  const pin = body && typeof body.pin === 'string' ? body.pin : '';

  if (!/^\d{4}$/.test(pin)) {
    c.status(400);
    return c.json({ error: 'PIN должен быть из 4 цифр' });
  }

  // Только сотрудники, назначенные на заведение этого устройства
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.role, s.pin_hash
     FROM staff s
     JOIN staff_venues sv ON sv.staff_id = s.id
     WHERE s.is_active = true AND sv.venue_id = $1`,
    [device.venue_id]
  );

  let matched = null;
  for (const staffMember of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, staffMember.pin_hash)) {
      matched = staffMember;
      break;
    }
  }

  if (!matched) {
    c.status(401);
    return c.json({ error: 'Неверный PIN' });
  }

  const payload = {
    sub: matched.id,
    type: 'staff',
    name: matched.name,
    role: matched.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const token = await sign(payload, process.env.JWT_SECRET);

  return c.json({
    token,
    staff: { id: matched.id, name: matched.name, role: matched.role },
  });
});

export default apiStaffAuth;

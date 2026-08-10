import { verify } from 'hono/jwt';

const JWT_ALG = 'HS256';

export async function requireStaffToken(c, next) {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    c.status(401);
    return c.json({ error: 'Не авторизован' });
  }

  try {
    const payload = await verify(token, process.env.JWT_SECRET, JWT_ALG);
    if (payload.type !== 'staff') {
      c.status(401);
      return c.json({ error: 'Не авторизован' });
    }
    c.set('staff', payload);
    await next();
  } catch {
    c.status(401);
    return c.json({ error: 'Не авторизован' });
  }
}

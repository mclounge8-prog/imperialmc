import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';

const JWT_ALG = 'HS256';

export async function requireAuthApi(c, next) {
  const token = getCookie(c, 'session');
  if (!token) {
    return c.json({ error: 'Не авторизован' }, 401);
  }
  try {
    const payload = await verify(token, process.env.JWT_SECRET, JWT_ALG);
    c.set('admin', payload);
    await next();
  } catch {
    return c.json({ error: 'Не авторизован' }, 401);
  }
}

export async function requireAuthPage(c, next) {
  const token = getCookie(c, 'session');
  if (!token) {
    return c.redirect('/login.html');
  }
  try {
    const payload = await verify(token, process.env.JWT_SECRET, JWT_ALG);
    c.set('admin', payload);
    await next();
  } catch {
    return c.redirect('/login.html');
  }
}

import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

const auth = new Hono();

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 часов — примерно одна смена

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.html('<p>Укажите логин и пароль</p>');
  }

  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role FROM admin_users WHERE username = $1',
    [username]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return c.html('<p>Неверный логин или пароль</p>');
  }

  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await sign(payload, process.env.JWT_SECRET);

  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: true,
  });

  // htmx сам выполнит переход по этому заголовку — отдельный клиентский JS не нужен
  c.header('HX-Redirect', '/dashboard');
  return c.body(null);
});

auth.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  c.header('HX-Redirect', '/login.html');
  return c.body(null);
});

export default auth;

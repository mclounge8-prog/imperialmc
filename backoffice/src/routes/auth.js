import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

const auth = new Hono();

// Долгая сессия для бэкофиса и PWA «Показатели»: не просим логин каждые 12 часов.
// На практике живёт, пока не разлогинятся / не удалят PWA / не очистят данные сайта.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // ~10 лет
const JWT_ALG = 'HS256';

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: true,
  };
}

async function authenticateAdmin(username, password) {
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role FROM admin_users WHERE username = $1',
    [username]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return null;
  }
  return user;
}

async function issueSessionCookie(c, user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await sign(payload, process.env.JWT_SECRET);
  setCookie(c, 'session', token, sessionCookieOptions());
  return { token, payload };
}

// HTML-форма бэкофиса (htmx)
auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.html('<p>Укажите логин и пароль</p>');
  }

  const user = await authenticateAdmin(username, password);
  if (!user) {
    return c.html('<p>Неверный логин или пароль</p>');
  }

  await issueSessionCookie(c, user);
  c.header('HX-Redirect', '/dashboard');
  return c.body(null);
});

// JSON-вход для PWA «Показатели» (fetch + cookie credentials: include)
auth.post('/login-json', async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = body && typeof body.username === 'string' ? body.username.trim() : '';
  const password = body && typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    c.status(400);
    return c.json({ error: 'Укажите логин и пароль' });
  }

  const user = await authenticateAdmin(username, password);
  if (!user) {
    c.status(401);
    return c.json({ error: 'Неверный логин или пароль' });
  }

  await issueSessionCookie(c, user);
  return c.json({ ok: true, username: user.username, role: user.role });
});

// Проверка сессии для PWA при старте и сразу после логина
auth.get('/me', async (c) => {
  const token = getCookie(c, 'session');
  if (!token) {
    c.status(401);
    return c.json({ error: 'Не авторизован' });
  }
  try {
    const payload = await verify(token, process.env.JWT_SECRET, JWT_ALG);
    return c.json({
      ok: true,
      username: payload.username,
      role: payload.role,
    });
  } catch {
    c.status(401);
    return c.json({ error: 'Не авторизован' });
  }
});

auth.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  // htmx-бэкофис смотрит HX-Redirect; PWA просто игнорирует тело
  c.header('HX-Redirect', '/login.html');
  return c.json({ ok: true });
});

export default auth;

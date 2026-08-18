import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

const auth = new Hono();

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 часов — примерно одна смена

async function findAndCheckUser(username, password) {
  // Логин сравниваем без учёта регистра: на телефоне часто уходит
  // «Mc-Imperial» / «MC-IMPERIAL» из автозаполнения или Shift, а в БД лежит
  // канонический «mc-imperial» — иначе bcrypt даже не вызывается и PWA
  // показывает «Неверный логин или пароль», хотя в бэкофисе те же данные
  // уже сохранены браузером в правильном регистре и проходят.
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role FROM admin_users WHERE lower(username) = lower($1)',
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
  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: true,
  });
}

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.html('<p>Укажите логин и пароль</p>');
  }

  const user = await findAndCheckUser(username, password);
  if (!user) {
    return c.html('<p>Неверный логин или пароль</p>');
  }

  await issueSessionCookie(c, user);

  // htmx сам выполнит переход по этому заголовку — отдельный клиентский JS не нужен
  c.header('HX-Redirect', '/dashboard');
  return c.body(null);
});

// JSON-версия входа — используется PWA «Показатели» (public/pwa/), у которой нет
// htmx и которая не может отличить успех от ошибки по пустому HTML-фрагменту:
// нужны нормальные коды ответа и JSON-тело.
auth.post('/login-json', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Некорректный запрос' }, 400);
  }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.json({ error: 'Укажите логин и пароль' }, 400);
  }

  const user = await findAndCheckUser(username, password);
  if (!user) {
    return c.json({ error: 'Неверный логин или пароль' }, 401);
  }

  await issueSessionCookie(c, user);

  return c.json({ username: user.username, role: user.role });
});

auth.get('/me', async (c) => {
  const token = getCookie(c, 'session');
  if (!token) {
    return c.json({ error: 'Не авторизован' }, 401);
  }
  try {
    const payload = await verify(token, process.env.JWT_SECRET, 'HS256');
    return c.json({ username: payload.username, role: payload.role });
  } catch {
    return c.json({ error: 'Не авторизован' }, 401);
  }
});

auth.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  c.header('HX-Redirect', '/login.html');
  return c.body(null);
});

export default auth;

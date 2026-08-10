import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { ROLES, renderStaffRow, renderStaffEditRow, renderStaffListOob } from '../views/staffView.js';

const staff = new Hono();
staff.use('*', requireAuthApi);

function isValidPin(pin) {
  return /^\d{4}$/.test(pin);
}

async function fetchStaff(id) {
  const { rows } = await pool.query(
    'SELECT id, name, role, is_active FROM staff WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// Создать сотрудника. Успех — пустой ответ + OOB-вставка строки в конец таблицы.
// Ошибка — текст ошибки попадает в #staff-form-error (это и есть primary target формы).
staff.post('/', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  const pin = String(body.pin || '');

  if (!name) return c.html('<p>Укажи имя сотрудника</p>');
  if (!ROLES[role]) return c.html('<p>Выбери роль</p>');
  if (!isValidPin(pin)) return c.html('<p>PIN должен быть из 4 цифр</p>');

  const pinHash = await bcrypt.hash(pin, 10);
  await pool.query('INSERT INTO staff (name, role, pin_hash) VALUES ($1, $2, $3)', [
    name,
    role,
    pinHash,
  ]);

  const { rows: allStaff } = await pool.query(
    'SELECT id, name, role, is_active FROM staff ORDER BY created_at DESC'
  );
  return c.html(renderStaffListOob(allStaff));
});

// Переключить строку в режим редактирования
staff.get('/:id/edit', async (c) => {
  const record = await fetchStaff(c.req.param('id'));
  if (!record) {
    c.status(404);
    return c.text('Сотрудник не найден');
  }
  return c.html(renderStaffEditRow(record));
});

// Отмена редактирования — вернуть обычную строку
staff.get('/:id/view', async (c) => {
  const record = await fetchStaff(c.req.param('id'));
  if (!record) {
    c.status(404);
    return c.text('Сотрудник не найден');
  }
  return c.html(renderStaffRow(record));
});

// Сохранить изменения. PIN необязателен — если пустой, хеш не трогаем.
staff.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  const pin = String(body.pin || '');

  const current = await fetchStaff(id);
  if (!current) {
    c.status(404);
    return c.text('Сотрудник не найден');
  }

  if (!name) {
    return c.html(renderStaffEditRow({ ...current }, 'Укажи имя'));
  }
  if (!ROLES[role]) {
    return c.html(renderStaffEditRow({ ...current, name }, 'Выбери роль'));
  }
  if (pin && !isValidPin(pin)) {
    return c.html(renderStaffEditRow({ ...current, name, role }, 'PIN должен быть из 4 цифр'));
  }

  if (pin) {
    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query('UPDATE staff SET name = $1, role = $2, pin_hash = $3 WHERE id = $4', [
      name,
      role,
      pinHash,
      id,
    ]);
  } else {
    await pool.query('UPDATE staff SET name = $1, role = $2 WHERE id = $3', [name, role, id]);
  }

  const updated = await fetchStaff(id);
  return c.html(renderStaffRow(updated));
});

// Включить/отключить без полного редактирования
staff.post('/:id/toggle', async (c) => {
  const { rows } = await pool.query(
    'UPDATE staff SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, role, is_active',
    [c.req.param('id')]
  );
  if (!rows[0]) {
    c.status(404);
    return c.text('Сотрудник не найден');
  }
  return c.html(renderStaffRow(rows[0]));
});

// Удалить. Пустой ответ + outerHTML на клиенте убирает строку из DOM.
staff.delete('/:id', async (c) => {
  await pool.query('DELETE FROM staff WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

export default staff;

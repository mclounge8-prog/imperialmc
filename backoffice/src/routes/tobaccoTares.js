import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import { renderTobaccoTaresSection, renderTobaccoTareEditRow } from '../views/tobaccoView.js';

const tobaccoTares = new Hono();
tobaccoTares.use('*', requireAuthApi);

async function fetchAllTares() {
  const { rows } = await pool.query(
    `SELECT id, brand, label, net_content_g, tare_weight_g, is_active, created_at
     FROM tobacco_tares
     ORDER BY brand, label`
  );
  return rows;
}

export async function renderTobaccoTaresFragment(errorMsg = null) {
  const tares = await fetchAllTares();
  return renderTobaccoTaresSection({ tares, errorMsg });
}

function parseBody(body) {
  const brand = String(body.brand || '').trim();
  const label = String(body.label || '').trim();
  const netRaw = body.net_content_g != null && body.net_content_g !== '' ? Number(body.net_content_g) : null;
  const tareWeight = Number(body.tare_weight_g);
  const isActive = body.is_active === '1' || body.is_active === 'on' || body.is_active === true;
  return { brand, label, netRaw, tareWeight, isActive };
}

tobaccoTares.post('/', async (c) => {
  const body = await c.req.parseBody();
  const { brand, label, netRaw, tareWeight } = parseBody(body);
  if (!brand || !label) {
    return c.html(await renderTobaccoTaresFragment('Укажите бренд и название'));
  }
  if (!Number.isFinite(tareWeight) || tareWeight < 0) {
    return c.html(await renderTobaccoTaresFragment('Укажите корректный вес тары'));
  }
  await pool.query(
    `INSERT INTO tobacco_tares (brand, label, net_content_g, tare_weight_g)
     VALUES ($1, $2, $3, $4)`,
    [brand, label, netRaw != null && Number.isFinite(netRaw) ? netRaw : null, tareWeight]
  );
  return c.html(await renderTobaccoTaresFragment());
});

tobaccoTares.get('/:id/edit', async (c) => {
  const { rows } = await pool.query('SELECT * FROM tobacco_tares WHERE id = $1', [c.req.param('id')]);
  if (!rows[0]) {
    c.status(404);
    return c.text('Тара не найдена');
  }
  return c.html(renderTobaccoTareEditRow(rows[0]));
});

tobaccoTares.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const { brand, label, netRaw, tareWeight, isActive } = parseBody(body);
  if (!brand || !label || !Number.isFinite(tareWeight) || tareWeight < 0) {
    const { rows } = await pool.query('SELECT * FROM tobacco_tares WHERE id = $1', [id]);
    return c.html(renderTobaccoTareEditRow(rows[0] || { id }, 'Проверьте поля'));
  }
  await pool.query(
    `UPDATE tobacco_tares
     SET brand = $1, label = $2, net_content_g = $3, tare_weight_g = $4, is_active = $5
     WHERE id = $6`,
    [brand, label, netRaw != null && Number.isFinite(netRaw) ? netRaw : null, tareWeight, isActive, id]
  );
  return c.html(await renderTobaccoTaresFragment());
});

tobaccoTares.delete('/:id', async (c) => {
  try {
    await pool.query('DELETE FROM tobacco_tares WHERE id = $1', [c.req.param('id')]);
  } catch (err) {
    // Если тара привязана к заведениям — мягко деактивируем.
    await pool.query('UPDATE tobacco_tares SET is_active = false WHERE id = $1', [c.req.param('id')]);
  }
  return c.body(null);
});

export default tobaccoTares;

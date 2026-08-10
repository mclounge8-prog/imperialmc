import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderModifiersSection,
  renderGroupAccordionSection,
  renderUngroupedAccordionSection,
  renderModifierRow,
  renderModifierEditRow,
  renderGroupSelectOob,
} from '../views/modifiersView.js';

const modifiers = new Hono();
modifiers.use('*', requireAuthApi);

export async function fetchModifierGroups() {
  const { rows } = await pool.query(
    'SELECT id, name, min_select, max_select FROM modifier_groups ORDER BY name'
  );
  return rows;
}

export async function fetchAllModifiers() {
  const { rows } = await pool.query(
    `SELECT m.id, m.group_id, m.name, m.price, m.warehouse_item_id, m.qty,
            wi.name AS warehouse_item_name, wi.unit AS warehouse_item_unit
     FROM modifiers m
     LEFT JOIN warehouse_items wi ON wi.id = m.warehouse_item_id
     ORDER BY m.name`
  );
  return rows;
}

async function fetchWarehouseItemsList() {
  const { rows } = await pool.query('SELECT id, name, unit FROM warehouse_items ORDER BY name');
  return rows;
}

async function fetchModifier(id) {
  const { rows } = await pool.query(
    `SELECT m.id, m.group_id, m.name, m.price, m.warehouse_item_id, m.qty,
            wi.name AS warehouse_item_name, wi.unit AS warehouse_item_unit
     FROM modifiers m
     LEFT JOIN warehouse_items wi ON wi.id = m.warehouse_item_id
     WHERE m.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function renderModifiersFragment() {
  const groups = await fetchModifierGroups();
  const allModifiers = await fetchAllModifiers();
  const warehouseItems = await fetchWarehouseItemsList();
  const ungrouped = allModifiers.filter((m) => !m.group_id);
  return renderModifiersSection(groups, ungrouped, allModifiers, warehouseItems);
}

modifiers.get('/', async (c) => c.html(await renderModifiersFragment()));

// ---------- Группы ----------

modifiers.post('/groups', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const minSelect = Number(body.min_select) || 0;
  const maxSelect = body.max_select ? Number(body.max_select) : null;

  if (!name) return c.html('<p>Укажи название группы</p>');
  if (maxSelect != null && maxSelect < 1) return c.html('<p>Максимум выбора должен быть не меньше 1</p>');

  const { rows } = await pool.query(
    'INSERT INTO modifier_groups (name, min_select, max_select) VALUES ($1, $2, $3) RETURNING id, name, min_select, max_select',
    [name, minSelect, maxSelect]
  );

  const groups = await fetchModifierGroups();
  return c.html(
    renderGroupAccordionSection(rows[0], [], { oob: true, forceOpen: true }) + renderGroupSelectOob(groups)
  );
});

modifiers.delete('/groups/:id', async (c) => {
  await pool.query('DELETE FROM modifier_groups WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

// ---------- Модификаторы ----------

modifiers.post('/', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  const groupId = body.group_id ? Number(body.group_id) : null;
  const warehouseItemId = body.warehouse_item_id ? Number(body.warehouse_item_id) : null;
  const qty = body.qty ? Number(body.qty) : 0;

  if (!name) return c.html('<p>Укажи название модификатора</p>');
  if (Number.isNaN(price) || price < 0) return c.html('<p>Цена должна быть числом ≥ 0</p>');
  if (warehouseItemId && (Number.isNaN(qty) || qty <= 0)) {
    return c.html('<p>Укажи количество для списания (больше нуля)</p>');
  }

  await pool.query(
    'INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty) VALUES ($1, $2, $3, $4, $5)',
    [groupId, name, price, warehouseItemId, warehouseItemId ? qty : 0]
  );

  const allModifiers = await fetchAllModifiers();
  if (groupId) {
    const { rows: groupRows } = await pool.query(
      'SELECT id, name, min_select, max_select FROM modifier_groups WHERE id = $1',
      [groupId]
    );
    const groupModifiers = allModifiers.filter((m) => m.group_id === groupId);
    return c.html(
      renderGroupAccordionSection(groupRows[0], groupModifiers, {
        oob: true,
        oobMode: 'replace',
        forceOpen: true,
      })
    );
  }

  const ungrouped = allModifiers.filter((m) => !m.group_id);
  return c.html(renderUngroupedAccordionSection(ungrouped, { oob: true, forceOpen: true }));
});

modifiers.get('/:id/edit', async (c) => {
  const modifier = await fetchModifier(c.req.param('id'));
  if (!modifier) {
    c.status(404);
    return c.text('Модификатор не найден');
  }
  const groups = await fetchModifierGroups();
  const warehouseItems = await fetchWarehouseItemsList();
  return c.html(renderModifierEditRow(modifier, groups, warehouseItems));
});

modifiers.get('/:id/view', async (c) => {
  const modifier = await fetchModifier(c.req.param('id'));
  if (!modifier) {
    c.status(404);
    return c.text('Модификатор не найден');
  }
  return c.html(renderModifierRow(modifier));
});

modifiers.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  const groupId = body.group_id ? Number(body.group_id) : null;
  const warehouseItemId = body.warehouse_item_id ? Number(body.warehouse_item_id) : null;
  const qty = body.qty ? Number(body.qty) : 0;

  const groups = await fetchModifierGroups();
  const warehouseItems = await fetchWarehouseItemsList();
  const current = await fetchModifier(id);
  if (!current) {
    c.status(404);
    return c.text('Модификатор не найден');
  }

  if (!name) {
    return c.html(renderModifierEditRow({ ...current }, groups, warehouseItems, 'Укажи название'));
  }
  if (Number.isNaN(price) || price < 0) {
    return c.html(
      renderModifierEditRow({ ...current, name }, groups, warehouseItems, 'Цена должна быть числом ≥ 0')
    );
  }

  await pool.query(
    'UPDATE modifiers SET name = $1, price = $2, group_id = $3, warehouse_item_id = $4, qty = $5 WHERE id = $6',
    [name, price, groupId, warehouseItemId, warehouseItemId ? qty : 0, id]
  );

  const updated = await fetchModifier(id);
  return c.html(renderModifierRow(updated));
});

modifiers.delete('/:id', async (c) => {
  await pool.query('DELETE FROM modifiers WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

export default modifiers;

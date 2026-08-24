import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderCategoryAccordionSection,
  renderUncategorizedAccordionSection,
  renderStockRow,
  renderCatalogEditRow,
  renderStockAccordion,
  renderItemCategorySelect,
} from '../views/warehouseView.js';

const warehouse = new Hono();
warehouse.use('*', requireAuthApi);

const UNIT_VALUES = ['g', 'ml', 'pcs'];

async function fetchCategories() {
  const { rows } = await pool.query('SELECT id, name FROM warehouse_categories ORDER BY name');
  return rows;
}

/**
 * Позиции склада, которые реально используются в меню выбранного заведения:
 * модификатор → позиция меню → категория меню не скрыта для этого venue
 * (как venue_hidden_menu_categories). Иначе на складе видны чужие сырьё
 * (например мясо KK при работе со складом lounge).
 */
async function fetchItemsForVenue(venueId) {
  if (!venueId) return [];
  const { rows } = await pool.query(
    `SELECT wi.id, wi.name, wi.category_id, wi.unit, wc.name AS category_name,
            COALESCE(vws.stock_qty, 0) AS stock_qty,
            COALESCE(vws.min_stock_qty, 0) AS min_stock_qty
     FROM warehouse_items wi
     LEFT JOIN warehouse_categories wc ON wc.id = wi.category_id
     LEFT JOIN venue_warehouse_stock vws
       ON vws.warehouse_item_id = wi.id AND vws.venue_id = $1
     WHERE EXISTS (
       SELECT 1
       FROM modifiers m
       JOIN menu_item_modifiers mim ON mim.modifier_id = m.id
       JOIN menu_items mi ON mi.id = mim.menu_item_id
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE m.warehouse_item_id = wi.id
         AND (
           mc.id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM venue_hidden_menu_categories h
             WHERE h.venue_id = $1 AND h.category_id = mc.id
           )
         )
         AND (
           mc.parent_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM venue_hidden_menu_categories h
             WHERE h.venue_id = $1 AND h.category_id = mc.parent_id
           )
         )
     )
     ORDER BY wi.name`,
    [venueId]
  );
  return rows;
}

async function fetchItemForVenue(venueId, itemId) {
  const { rows } = await pool.query(
    `SELECT wi.id, wi.name, wi.category_id, wi.unit, wc.name AS category_name,
            COALESCE(vws.stock_qty, 0) AS stock_qty,
            COALESCE(vws.min_stock_qty, 0) AS min_stock_qty
     FROM warehouse_items wi
     LEFT JOIN warehouse_categories wc ON wc.id = wi.category_id
     LEFT JOIN venue_warehouse_stock vws ON vws.warehouse_item_id = wi.id AND vws.venue_id = $1
     WHERE wi.id = $2`,
    [venueId, itemId]
  );
  return rows[0] || null;
}

// ---------- Переключение заведения ----------

warehouse.get('/stock', async (c) => {
  const venueId = c.req.query('venueId');
  const categories = await fetchCategories();
  const items = await fetchItemsForVenue(venueId);
  return c.html(renderStockAccordion(venueId, categories, items));
});

// ---------- Категории (общий каталог) ----------

warehouse.post('/categories', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const venueId = body.venue_id;
  if (!name) return c.html('<p>Укажи название категории</p>');

  const { rows } = await pool.query(
    'INSERT INTO warehouse_categories (name) VALUES ($1) RETURNING id, name',
    [name]
  );

  const categories = await fetchCategories();
  return c.html(
    renderCategoryAccordionSection(venueId, rows[0], [], { oob: true, forceOpen: true }) +
      renderItemCategorySelect(categories, { oob: true })
  );
});

warehouse.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const venueId = c.req.query('venueId');
  try {
    await pool.query('DELETE FROM warehouse_categories WHERE id = $1', [id]);
    return c.body(null);
  } catch (err) {
    if (err.code === '23503') {
      const { rows } = await pool.query('SELECT id, name FROM warehouse_categories WHERE id = $1', [id]);
      if (rows[0]) {
        const items = await fetchItemsForVenue(venueId);
        const categoryItems = items.filter((i) => i.category_id === Number(id));
        return c.html(renderCategoryAccordionSection(venueId, rows[0], categoryItems));
      }
      return c.body(null);
    }
    throw err;
  }
});

// ---------- Каталог (общий для всех заведений) ----------

warehouse.post('/items', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const categoryId = body.category_id ? Number(body.category_id) : null;
  const unit = String(body.unit || '');
  const venueId = body.venue_id;

  if (!name) return c.html('<p>Укажи наименование</p>');
  if (!UNIT_VALUES.includes(unit)) return c.html('<p>Выбери единицу измерения</p>');

  await pool.query('INSERT INTO warehouse_items (category_id, name, unit) VALUES ($1, $2, $3)', [
    categoryId,
    name,
    unit,
  ]);

  // Целиком перерисовываем затронутую секцию (а не вставляем строку в конец) —
  // так позиции внутри неё сразу отсортированы как при обычной загрузке
  // (по имени), а соседние категории не сворачиваются/не теряют состояние.
  const items = await fetchItemsForVenue(venueId);
  if (categoryId) {
    const { rows: catRows } = await pool.query('SELECT id, name FROM warehouse_categories WHERE id = $1', [
      categoryId,
    ]);
    const categoryItems = items.filter((i) => i.category_id === categoryId);
    return c.html(
      renderCategoryAccordionSection(venueId, catRows[0], categoryItems, {
        oob: true,
        oobMode: 'replace',
        forceOpen: true,
      })
    );
  }

  const uncategorizedItems = items.filter((i) => !i.category_id);
  return c.html(
    renderUncategorizedAccordionSection(venueId, uncategorizedItems, { oob: true, forceOpen: true })
  );
});

warehouse.get('/items/:id/edit', async (c) => {
  const venueId = c.req.query('venueId');
  const item = await fetchItemForVenue(venueId, c.req.param('id'));
  if (!item) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  const categories = await fetchCategories();
  return c.html(renderCatalogEditRow(item, categories, venueId));
});

warehouse.get('/venues/:venueId/items/:itemId/view', async (c) => {
  const { venueId, itemId } = c.req.param();
  const item = await fetchItemForVenue(venueId, itemId);
  if (!item) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  return c.html(renderStockRow(venueId, item));
});

warehouse.put('/items/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const categoryId = body.category_id ? Number(body.category_id) : null;
  const unit = String(body.unit || '');
  // venueId нужен только чтобы после сохранения вернуть строку остатка того же заведения
  const venueId = body.venue_id;

  const categories = await fetchCategories();
  const { rows: currentRows } = await pool.query(
    'SELECT id, name, category_id, unit FROM warehouse_items WHERE id = $1',
    [id]
  );
  const current = currentRows[0];
  if (!current) {
    c.status(404);
    return c.text('Позиция не найдена');
  }

  if (!name) {
    return c.html(renderCatalogEditRow({ ...current }, categories, venueId, 'Укажи наименование'));
  }
  if (!UNIT_VALUES.includes(unit)) {
    return c.html(renderCatalogEditRow({ ...current, name }, categories, venueId, 'Выбери единицу измерения'));
  }

  await pool.query('UPDATE warehouse_items SET name = $1, category_id = $2, unit = $3 WHERE id = $4', [
    name,
    categoryId,
    unit,
    id,
  ]);

  const updated = await fetchItemForVenue(venueId, id);
  return c.html(renderStockRow(venueId, updated));
});

warehouse.delete('/items/:id', async (c) => {
  await pool.query('DELETE FROM warehouse_items WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

// ---------- Остаток по конкретному заведению (upsert) ----------

warehouse.put('/venues/:venueId/items/:itemId/stock', async (c) => {
  const { venueId, itemId } = c.req.param();
  const body = await c.req.parseBody();
  const stockQty = Number(body.stock_qty);
  const minStockQty = Number(body.min_stock_qty);

  if (Number.isNaN(stockQty) || stockQty < 0 || Number.isNaN(minStockQty) || minStockQty < 0) {
    const item = await fetchItemForVenue(venueId, itemId);
    return c.html(renderStockRow(venueId, item));
  }

  await pool.query(
    `INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (venue_id, warehouse_item_id)
     DO UPDATE SET stock_qty = $3, min_stock_qty = $4`,
    [venueId, itemId, stockQty, minStockQty]
  );

  const updated = await fetchItemForVenue(venueId, itemId);
  return c.html(renderStockRow(venueId, updated));
});

export default warehouse;

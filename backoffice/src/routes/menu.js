import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderMenuCategoryAccordionSection,
  renderMenuItemRow,
  renderMenuItemEditRow,
  renderMenuVenueContainer,
  renderRecipeEditor,
  renderRecipeRow,
} from '../views/menuView.js';

const menu = new Hono();
menu.use('*', requireAuthApi);

async function fetchMenuCategories() {
  const { rows } = await pool.query(
    'SELECT id, name, icon FROM menu_categories ORDER BY sort_order, name'
  );
  return rows;
}

async function fetchHiddenCategoryIds(venueId) {
  const { rows } = await pool.query(
    'SELECT category_id FROM venue_hidden_menu_categories WHERE venue_id = $1',
    [venueId]
  );
  return rows.map((r) => r.category_id);
}

async function fetchAllMenuItems() {
  const { rows } = await pool.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.price, mi.image_url, mi.is_active,
            (SELECT COUNT(*) FROM menu_item_recipe WHERE menu_item_id = mi.id) AS recipe_count
     FROM menu_items mi
     ORDER BY mi.created_at DESC`
  );
  return rows;
}

async function fetchMenuItemWithCategory(id) {
  const { rows } = await pool.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.price, mi.image_url, mi.is_active, mc.name AS category_name,
            (SELECT COUNT(*) FROM menu_item_recipe WHERE menu_item_id = mi.id) AS recipe_count
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     WHERE mi.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---------- Переключение заведения (видимость категорий смотрится для него) ----------

menu.get('/venue-view', async (c) => {
  const venueId = c.req.query('venueId');
  const categories = await fetchMenuCategories();
  const hiddenCategoryIds = await fetchHiddenCategoryIds(venueId);
  const items = await fetchAllMenuItems();
  return c.html(renderMenuVenueContainer(venueId, categories, hiddenCategoryIds, items));
});

// ---------- Видимость категории по заведению ----------

menu.post('/venues/:venueId/categories/:categoryId/toggle-visibility', async (c) => {
  const { venueId, categoryId } = c.req.param();

  const { rows: existing } = await pool.query(
    'SELECT 1 FROM venue_hidden_menu_categories WHERE venue_id = $1 AND category_id = $2',
    [venueId, categoryId]
  );

  if (existing[0]) {
    await pool.query(
      'DELETE FROM venue_hidden_menu_categories WHERE venue_id = $1 AND category_id = $2',
      [venueId, categoryId]
    );
  } else {
    await pool.query(
      'INSERT INTO venue_hidden_menu_categories (venue_id, category_id) VALUES ($1, $2)',
      [venueId, categoryId]
    );
  }

  const { rows: catRows } = await pool.query(
    'SELECT id, name, icon FROM menu_categories WHERE id = $1',
    [categoryId]
  );
  const allItems = await fetchAllMenuItems();
  const categoryItems = allItems.filter((i) => i.category_id === Number(categoryId));
  const hiddenCategoryIds = await fetchHiddenCategoryIds(venueId);

  return c.html(
    renderMenuCategoryAccordionSection(
      catRows[0],
      categoryItems,
      venueId,
      hiddenCategoryIds.includes(Number(categoryId))
    )
  );
});

// ---------- Категории меню (общий каталог) ----------

menu.post('/categories', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const icon = String(body.icon || '').trim() || null;
  const venueId = body.venue_id;
  if (!name) return c.html('<p>Укажи название категории</p>');

  const { rows } = await pool.query(
    'INSERT INTO menu_categories (name, icon) VALUES ($1, $2) RETURNING id, name, icon',
    [name, icon]
  );
  return c.html(
    renderMenuCategoryAccordionSection(rows[0], [], venueId, false, { oob: true })
  );
});

menu.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const venueId = c.req.query('venueId');
  try {
    await pool.query('DELETE FROM menu_categories WHERE id = $1', [id]);
    return c.body(null);
  } catch (err) {
    if (err.code === '23503') {
      const { rows: catRows } = await pool.query(
        'SELECT id, name, icon FROM menu_categories WHERE id = $1',
        [id]
      );
      if (catRows[0]) {
        const allItems = await fetchAllMenuItems();
        const categoryItems = allItems.filter((i) => i.category_id === Number(id));
        const hiddenCategoryIds = await fetchHiddenCategoryIds(venueId);
        return c.html(
          renderMenuCategoryAccordionSection(
            catRows[0],
            categoryItems,
            venueId,
            hiddenCategoryIds.includes(Number(id))
          )
        );
      }
      return c.body(null);
    }
    throw err;
  }
});

// ---------- Позиции меню ----------

menu.post('/items', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const categoryId = body.category_id ? Number(body.category_id) : null;
  const price = Number(body.price);

  if (!name) return c.html('<p>Укажи наименование</p>');
  if (Number.isNaN(price) || price < 0) return c.html('<p>Цена должна быть числом ≥ 0</p>');

  const { rows } = await pool.query(
    'INSERT INTO menu_items (category_id, name, price) VALUES ($1, $2, $3) RETURNING id',
    [categoryId, name, price]
  );

  const created = await fetchMenuItemWithCategory(rows[0].id);
  const targetId = categoryId ? `menu-category-items-${categoryId}` : 'menu-uncategorized-items';
  return c.html(renderMenuItemRow(created, { oob: true, targetId }));
});

menu.get('/items/:id/edit', async (c) => {
  const item = await fetchMenuItemWithCategory(c.req.param('id'));
  if (!item) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  const categories = await fetchMenuCategories();
  return c.html(renderMenuItemEditRow(item, categories));
});

menu.get('/items/:id/view', async (c) => {
  const item = await fetchMenuItemWithCategory(c.req.param('id'));
  if (!item) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  return c.html(renderMenuItemRow(item));
});

// Если категория поменялась — строка должна "переехать" в другой аккордеон:
// основной ответ убирает её со старого места (пусто), OOB вставляет в новый.
menu.put('/items/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const categoryId = body.category_id ? Number(body.category_id) : null;
  const price = Number(body.price);

  const current = await fetchMenuItemWithCategory(id);
  if (!current) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  const categories = await fetchMenuCategories();

  if (!name) {
    return c.html(renderMenuItemEditRow({ ...current }, categories, 'Укажи наименование'));
  }
  if (Number.isNaN(price) || price < 0) {
    return c.html(renderMenuItemEditRow({ ...current, name }, categories, 'Цена должна быть числом ≥ 0'));
  }

  const categoryChanged = (current.category_id || null) !== (categoryId || null);

  await pool.query('UPDATE menu_items SET name = $1, category_id = $2, price = $3 WHERE id = $4', [
    name,
    categoryId,
    price,
    id,
  ]);

  const updated = await fetchMenuItemWithCategory(id);

  if (categoryChanged) {
    const targetId = categoryId ? `menu-category-items-${categoryId}` : 'menu-uncategorized-items';
    return c.html(renderMenuItemRow(updated, { oob: true, targetId }));
  }

  return c.html(renderMenuItemRow(updated));
});

menu.post('/items/:id/toggle', async (c) => {
  const { rows } = await pool.query(
    'UPDATE menu_items SET is_active = NOT is_active WHERE id = $1 RETURNING id',
    [c.req.param('id')]
  );
  if (!rows[0]) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  const updated = await fetchMenuItemWithCategory(rows[0].id);
  return c.html(renderMenuItemRow(updated));
});

menu.delete('/items/:id', async (c) => {
  await pool.query('DELETE FROM menu_items WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

// ---------- Рецептура ----------

menu.get('/items/:id/recipe', async (c) => {
  const menuItem = await fetchMenuItemWithCategory(c.req.param('id'));
  if (!menuItem) {
    c.status(404);
    return c.text('Позиция не найдена');
  }

  const { rows: recipeRows } = await pool.query(
    `SELECT mir.id, mir.menu_item_id, mir.qty, wi.name AS warehouse_item_name, wi.unit
     FROM menu_item_recipe mir
     JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id
     WHERE mir.menu_item_id = $1
     ORDER BY wi.name`,
    [menuItem.id]
  );

  const { rows: warehouseItems } = await pool.query(
    'SELECT id, name, unit FROM warehouse_items ORDER BY name'
  );

  return c.html(renderRecipeEditor(menuItem, recipeRows, warehouseItems));
});

menu.post('/items/:id/recipe', async (c) => {
  const menuItemId = c.req.param('id');
  const body = await c.req.parseBody();
  const warehouseItemId = body.warehouse_item_id ? Number(body.warehouse_item_id) : null;
  const qty = Number(body.qty);

  if (!warehouseItemId) return c.html('<p>Выбери ингредиент</p>');
  if (Number.isNaN(qty) || qty <= 0) return c.html('<p>Количество должно быть больше нуля</p>');

  const { rows } = await pool.query(
    `INSERT INTO menu_item_recipe (menu_item_id, warehouse_item_id, qty)
     VALUES ($1, $2, $3) RETURNING id`,
    [menuItemId, warehouseItemId, qty]
  );

  const { rows: recipeRows } = await pool.query(
    `SELECT mir.id, mir.menu_item_id, mir.qty, wi.name AS warehouse_item_name, wi.unit
     FROM menu_item_recipe mir
     JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id
     WHERE mir.id = $1`,
    [rows[0].id]
  );

  return c.html(renderRecipeRow(recipeRows[0], { oob: true }));
});

menu.delete('/items/:menuItemId/recipe/:recipeId', async (c) => {
  await pool.query('DELETE FROM menu_item_recipe WHERE id = $1', [c.req.param('recipeId')]);
  return c.body(null);
});

// ---------- Изображение позиции ----------

menu.post('/items/:id/image', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const file = body.image;

  if (!file || typeof file === 'string') {
    c.status(400);
    return c.html('<p>Файл не выбран</p>');
  }
  if (!file.type || !file.type.startsWith('image/')) {
    c.status(400);
    return c.html('<p>Нужен файл изображения</p>');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = path.extname(file.name || '').toLowerCase() || '.jpg';
  const filename = `item-${id}-${Date.now()}${ext}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'menu');

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), buffer);

  const imageUrl = `/uploads/menu/${filename}`;
  await pool.query('UPDATE menu_items SET image_url = $1 WHERE id = $2', [imageUrl, id]);

  const updated = await fetchMenuItemWithCategory(id);
  return c.html(renderMenuItemRow(updated));
});

export default menu;

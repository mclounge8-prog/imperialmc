import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderMenuCategoryAccordionSection,
  renderMenuUncategorizedAccordionSection,
  renderMenuItemRow,
  renderMenuItemEditRow,
  renderMenuItemCategorySelect,
  renderMenuVenueContainer,
  renderModifierAttachmentsEditor,
  renderModifierAttachmentsList,
  renderModifierAttachmentRow,
  renderAttachModifierSelect,
} from '../views/menuView.js';

const menu = new Hono();
menu.use('*', requireAuthApi);

async function fetchMenuCategories() {
  const { rows } = await pool.query(
    'SELECT id, name, icon, parent_id, sort_order FROM menu_categories ORDER BY sort_order, name'
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
            (SELECT COUNT(*) FROM menu_item_modifiers WHERE menu_item_id = mi.id) AS recipe_count
     FROM menu_items mi
     ORDER BY mi.created_at DESC`
  );
  return rows;
}

async function fetchMenuItemWithCategory(id) {
  const { rows } = await pool.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.price, mi.image_url, mi.is_active, mc.name AS category_name,
            (SELECT COUNT(*) FROM menu_item_modifiers WHERE menu_item_id = mi.id) AS recipe_count
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     WHERE mi.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function fetchMenuItemModifierAttachments(menuItemId) {
  const { rows } = await pool.query(
    `SELECT mim.id, mim.modifier_id, mim.is_default,
            m.name, m.group_id, mg.name AS group_name,
            COALESCE(mim.price_override, m.price) AS price,
            COALESCE(mim.qty_override, m.qty) AS qty,
            m.warehouse_item_id, wi.name AS warehouse_item_name, wi.unit AS warehouse_item_unit
     FROM menu_item_modifiers mim
     JOIN modifiers m ON m.id = mim.modifier_id
     LEFT JOIN modifier_groups mg ON mg.id = m.group_id
     LEFT JOIN warehouse_items wi ON wi.id = m.warehouse_item_id
     WHERE mim.menu_item_id = $1
     ORDER BY mg.name NULLS FIRST, m.name`,
    [menuItemId]
  );
  return rows;
}

async function fetchAvailableModifiersToAttach(menuItemId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.price, m.group_id, mg.name AS group_name
     FROM modifiers m
     LEFT JOIN modifier_groups mg ON mg.id = m.group_id
     WHERE NOT EXISTS (
       SELECT 1 FROM menu_item_modifiers mim
       WHERE mim.menu_item_id = $1 AND mim.modifier_id = m.id
     )
     ORDER BY mg.name NULLS FIRST, m.name`,
    [menuItemId]
  );
  return rows;
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
  const parentId = body.parent_id ? Number(body.parent_id) : null;
  const venueId = body.venue_id;
  if (!name) return c.html('<p>Укажи название категории</p>');

  const { rows } = await pool.query(
    'INSERT INTO menu_categories (name, icon, parent_id) VALUES ($1, $2, $3) RETURNING id, name, icon, parent_id',
    [name, icon, parentId]
  );

  const categories = await fetchMenuCategories();
  return c.html(
    renderMenuCategoryAccordionSection(rows[0], [], venueId, false, { oob: true }) +
      renderMenuItemCategorySelect(categories, { oob: true })
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
  const venueId = body.venue_id;

  if (!name) return c.html('<p>Укажи наименование</p>');
  if (Number.isNaN(price) || price < 0) return c.html('<p>Цена должна быть числом ≥ 0</p>');

  await pool.query('INSERT INTO menu_items (category_id, name, price) VALUES ($1, $2, $3)', [
    categoryId,
    name,
    price,
  ]);

  // Целиком перерисовываем затронутую секцию — позиции внутри неё сразу в
  // правильном порядке (новые сверху, как при обычной загрузке раздела),
  // соседние категории не трогаем (их состояние "открыто/закрыто" не сбрасывается).
  const allItems = await fetchAllMenuItems();
  if (categoryId) {
    const { rows: catRows } = await pool.query(
      'SELECT id, name, icon FROM menu_categories WHERE id = $1',
      [categoryId]
    );
    const categoryItems = allItems.filter((i) => i.category_id === categoryId);
    const hiddenCategoryIds = await fetchHiddenCategoryIds(venueId);
    return c.html(
      renderMenuCategoryAccordionSection(
        catRows[0],
        categoryItems,
        venueId,
        hiddenCategoryIds.includes(categoryId),
        { oob: true, oobMode: 'replace', forceOpen: true }
      )
    );
  }

  const uncategorizedItems = allItems.filter((i) => !i.category_id);
  return c.html(renderMenuUncategorizedAccordionSection(uncategorizedItems, { oob: true, forceOpen: true }));
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

// ---------- Модификаторы позиции (замена старой рецептуры) ----------

menu.get('/items/:id/modifiers', async (c) => {
  const menuItem = await fetchMenuItemWithCategory(c.req.param('id'));
  if (!menuItem) {
    c.status(404);
    return c.text('Позиция не найдена');
  }
  const attachments = await fetchMenuItemModifierAttachments(menuItem.id);
  const available = await fetchAvailableModifiersToAttach(menuItem.id);
  return c.html(renderModifierAttachmentsEditor(menuItem, attachments, available));
});

menu.post('/items/:id/modifiers', async (c) => {
  const menuItemId = c.req.param('id');
  const body = await c.req.parseBody();
  const modifierId = body.modifier_id ? Number(body.modifier_id) : null;
  const isDefault = body.is_default === 'on' || body.is_default === 'true';

  if (!modifierId) return c.html('<p>Выбери модификатор</p>');

  await pool.query(
    `INSERT INTO menu_item_modifiers (menu_item_id, modifier_id, is_default)
     VALUES ($1, $2, $3)
     ON CONFLICT (menu_item_id, modifier_id) DO NOTHING`,
    [menuItemId, modifierId, isDefault]
  );

  const attachments = await fetchMenuItemModifierAttachments(menuItemId);
  const available = await fetchAvailableModifiersToAttach(menuItemId);
  return c.html(
    renderModifierAttachmentsList(menuItemId, attachments) +
      renderAttachModifierSelect(available, { oob: true })
  );
});

menu.put('/items/:menuItemId/modifiers/:attachmentId', async (c) => {
  const { menuItemId, attachmentId } = c.req.param();
  const body = await c.req.parseBody();
  const isDefault = body.is_default === 'on' || body.is_default === 'true';

  await pool.query('UPDATE menu_item_modifiers SET is_default = $1 WHERE id = $2 AND menu_item_id = $3', [
    isDefault,
    attachmentId,
    menuItemId,
  ]);

  const attachments = await fetchMenuItemModifierAttachments(menuItemId);
  const updated = attachments.find((a) => String(a.id) === String(attachmentId));
  if (!updated) {
    c.status(404);
    return c.text('Модификатор не прикреплён к этой позиции');
  }
  return c.html(renderModifierAttachmentRow(menuItemId, updated));
});

menu.delete('/items/:menuItemId/modifiers/:attachmentId', async (c) => {
  const { menuItemId, attachmentId } = c.req.param();
  await pool.query('DELETE FROM menu_item_modifiers WHERE id = $1 AND menu_item_id = $2', [
    attachmentId,
    menuItemId,
  ]);

  const attachments = await fetchMenuItemModifierAttachments(menuItemId);
  const available = await fetchAvailableModifiersToAttach(menuItemId);
  return c.html(
    renderModifierAttachmentsList(menuItemId, attachments) +
      renderAttachModifierSelect(available, { oob: true })
  );
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

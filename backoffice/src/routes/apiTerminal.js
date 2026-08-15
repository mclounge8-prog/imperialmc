import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';

const apiTerminal = new Hono();
// Заведения, назначенные вошедшему сотруднику — терминал спрашивает,
// с каким работаем, если их несколько (или выбирает единственное сам)
apiTerminal.get('/venues', requireStaffToken, async (c) => {
  const staff = c.get('staff');
  const { rows } = await pool.query(
    `SELECT v.id, v.name FROM staff_venues sv
     JOIN venues v ON v.id = sv.venue_id
     WHERE sv.staff_id = $1
     ORDER BY v.name`,
    [staff.sub]
  );
  return c.json({ venues: rows });
});

apiTerminal.get('/tables', requireStaffToken, async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows: zones } = await pool.query(
    'SELECT id, name FROM zones WHERE venue_id = $1 ORDER BY name',
    [venueId]
  );
  const { rows: tableRows } = await pool.query(
    `SELECT t.id, t.zone_id, t.name, t.capacity, t.status, t.pos_x, t.pos_y
     FROM tables t
     JOIN zones z ON z.id = t.zone_id
     WHERE z.venue_id = $1
     ORDER BY t.id`,
    [venueId]
  );

  const zonesWithTables = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    tables: tableRows
      .filter((t) => t.zone_id === zone.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        capacity: t.capacity,
        status: t.status,
        posX: t.pos_x,
        posY: t.pos_y,
      })),
  }));

  return c.json({ zones: zonesWithTables });
});

apiTerminal.get('/menu', requireStaffToken, async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows: categories } = await pool.query(
    `SELECT mc.id, mc.name, mc.icon, mc.parent_id, mc.sort_order
     FROM menu_categories mc
     WHERE NOT EXISTS (
       SELECT 1 FROM venue_hidden_menu_categories vhmc
       WHERE vhmc.venue_id = $1 AND vhmc.category_id = mc.id
     )
     ORDER BY mc.sort_order, mc.name`,
    [venueId]
  );
  const { rows: itemRows } = await pool.query(
    'SELECT id, category_id, name, price, image_url FROM menu_items WHERE is_active = true ORDER BY name'
  );

  // Модификаторы сразу для всех позиций одним запросом (не N+1) — терминалу
  // нужны и для справочника состава, и для экрана настройки при добавлении
  // в заказ (что включено по умолчанию, что можно докупить, ограничения групп).
  const { rows: modifierRows } = await pool.query(
    `SELECT mim.menu_item_id, mim.modifier_id, mim.is_default,
            m.name, m.group_id, mg.name AS group_name, mg.min_select, mg.max_select,
            COALESCE(mim.price_override, m.price) AS price,
            COALESCE(mim.qty_override, m.qty) AS qty,
            wi.unit AS warehouse_unit
     FROM menu_item_modifiers mim
     JOIN modifiers m ON m.id = mim.modifier_id
     LEFT JOIN modifier_groups mg ON mg.id = m.group_id
     LEFT JOIN warehouse_items wi ON wi.id = m.warehouse_item_id
     ORDER BY mg.name NULLS FIRST, m.name`
  );

  const modifierRowsByItem = new Map();
  for (const row of modifierRows) {
    if (!modifierRowsByItem.has(row.menu_item_id)) modifierRowsByItem.set(row.menu_item_id, []);
    modifierRowsByItem.get(row.menu_item_id).push(row);
  }

  // Ингредиенты без группы (обычные, без ограничения выбора) собираются в один
  // синтетический "Состав" — реальные группы (с лимитом выбора) идут отдельно.
  function buildModifierGroups(itemId) {
    const rows = modifierRowsByItem.get(itemId) || [];
    const groups = new Map();
    for (const row of rows) {
      const key = row.group_id || 'ungrouped';
      if (!groups.has(key)) {
        groups.set(key, {
          id: row.group_id || null,
          name: row.group_id ? row.group_name : 'Состав',
          minSelect: row.group_id ? row.min_select : 0,
          maxSelect: row.group_id ? row.max_select : null,
          options: [],
        });
      }
      groups.get(key).options.push({
        modifierId: row.modifier_id,
        name: row.name,
        price: Number(row.price),
        isDefault: row.is_default,
        qty: Number(row.qty) || 0,
        unit: row.warehouse_unit || null,
      });
    }
    return [...groups.values()];
  }

  const mapItem = (item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    imageUrl: item.image_url,
    modifierGroups: buildModifierGroups(item.id),
  });

  // Дерево категорий: в корне только parent_id IS NULL, дети — в children.
  // Скрытая родительская категория уже отфильтрована запросом выше.
  function buildCategoryTree(parentId) {
    return categories
      .filter((cat) => (cat.parent_id || null) === parentId)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        parentId: cat.parent_id || null,
        items: itemRows.filter((item) => item.category_id === cat.id).map(mapItem),
        children: buildCategoryTree(cat.id),
      }));
  }

  const categoriesWithItems = buildCategoryTree(null);

  // Позиции без категории видны всегда — прятать по заведению можно только категории
  const uncategorized = itemRows.filter((item) => !item.category_id).map(mapItem);

  return c.json({ categories: categoriesWithItems, uncategorized });
});

export default apiTerminal;

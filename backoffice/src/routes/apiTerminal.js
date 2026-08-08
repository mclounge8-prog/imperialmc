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
    `SELECT mc.id, mc.name, mc.icon
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

  // Рецептура сразу для всех позиций одним запросом (не N+1) — нужна терминалу
  // для справочника состава независимо от того, есть ли активный заказ
  const { rows: recipeRows } = await pool.query(
    `SELECT mir.menu_item_id, wi.name, mir.qty, wi.unit
     FROM menu_item_recipe mir
     JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id`
  );
  const recipeByItem = new Map();
  for (const r of recipeRows) {
    if (!recipeByItem.has(r.menu_item_id)) recipeByItem.set(r.menu_item_id, []);
    recipeByItem.get(r.menu_item_id).push({ name: r.name, qty: Number(r.qty), unit: r.unit });
  }

  const mapItem = (item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    imageUrl: item.image_url,
    recipe: recipeByItem.get(item.id) || [],
  });

  const categoriesWithItems = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    icon: cat.icon,
    items: itemRows.filter((item) => item.category_id === cat.id).map(mapItem),
  }));

  // Позиции без категории видны всегда — прятать по заведению можно только категории
  const uncategorized = itemRows.filter((item) => !item.category_id).map(mapItem);

  return c.json({ categories: categoriesWithItems, uncategorized });
});

export default apiTerminal;

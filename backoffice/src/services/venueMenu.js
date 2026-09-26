import { pool } from '../db.js';

/** Меню заведения: дерево категорий + позиции с группами модификаторов.
 * Общее для терминала официанта и киоска самообслуживания. */
export async function fetchVenueMenu(venueId) {
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
    return [...groups.values()].map((group) => {
      const optionCount = group.options.length;
      const minSelect = Math.min(Number(group.minSelect) || 0, optionCount);
      let maxSelect = group.maxSelect;
      if (maxSelect != null) {
        maxSelect = Math.min(Number(maxSelect), optionCount);
      }
      group.options.sort((a, b) => {
        if (a.isDefault === b.isDefault) return String(a.name).localeCompare(String(b.name), 'ru');
        return a.isDefault ? -1 : 1;
      });
      return { ...group, minSelect, maxSelect };
    });
  }

  const mapItem = (item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    imageUrl: item.image_url,
    modifierGroups: buildModifierGroups(item.id),
  });

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
  const uncategorized = itemRows.filter((item) => !item.category_id).map(mapItem);

  return { categories: categoriesWithItems, uncategorized };
}

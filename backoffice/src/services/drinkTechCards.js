import { pool } from '../db.js';
import { DRINK_CARDS, DRINK_TECH_CARD_VERSION, matchDrinkCard } from './drinkCards.js';

const SCHEMA = [
  `ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS serve_in VARCHAR(80)`,
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS serve_in VARCHAR(80)`,
  `ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS unit VARCHAR(8)`,
  `ALTER TABLE kitchen_ticket_items ADD COLUMN IF NOT EXISTS serve_in VARCHAR(80)`,
  `CREATE TABLE IF NOT EXISTS drink_tech_card_applied (
     menu_item_id INT PRIMARY KEY REFERENCES menu_items(id) ON DELETE CASCADE,
     card_id TEXT NOT NULL,
     version INT NOT NULL,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

async function findWarehouse(client, name) {
  if (!name) return null;
  const { rows } = await client.query(
    `SELECT id, unit FROM warehouse_items
     WHERE lower(name) = lower($1)
     ORDER BY id
     LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function ensureModifier(client, spec) {
  const { rows } = await client.query(
    `SELECT id, warehouse_item_id
     FROM modifiers
     WHERE group_id IS NULL AND lower(name) = lower($1)
     ORDER BY (warehouse_item_id IS NULL), id
     LIMIT 1`,
    [spec.modifier]
  );
  let row = rows[0];
  if (!row) {
    const warehouse = await findWarehouse(client, spec.warehouseName);
    const inserted = await client.query(
      `INSERT INTO modifiers (name, price, warehouse_item_id, qty, unit)
       VALUES ($1, 0, $2, 0, $3)
       RETURNING id, warehouse_item_id`,
      [spec.modifier, warehouse ? warehouse.id : null, warehouse ? warehouse.unit : null]
    );
    return inserted.rows[0];
  }
  if (!row.warehouse_item_id && spec.warehouseName) {
    const warehouse = await findWarehouse(client, spec.warehouseName);
    if (warehouse) {
      await client.query(
        `UPDATE modifiers
         SET warehouse_item_id = $2
         WHERE id = $1 AND warehouse_item_id IS NULL`,
        [row.id, warehouse.id]
      );
      row = { ...row, warehouse_item_id: warehouse.id };
    }
  }
  return row;
}

async function applyCard(client, item, card) {
  const modifierIds = [];
  for (let index = 0; index < card.ingredients.length; index += 1) {
    const spec = card.ingredients[index];
    // eslint-disable-next-line no-await-in-loop
    const modifier = await ensureModifier(client, spec);
    modifierIds.push(modifier.id);
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO menu_item_modifiers
         (menu_item_id, modifier_id, is_default, qty_override, sort_order)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (menu_item_id, modifier_id) DO UPDATE
       SET is_default = true,
           qty_override = EXCLUDED.qty_override,
           sort_order = EXCLUDED.sort_order`,
      [item.id, modifier.id, spec.qty, (index + 1) * 10]
    );
  }

  await client.query(
    `DELETE FROM menu_item_modifiers mim
     USING modifiers m
     WHERE mim.menu_item_id = $1
       AND mim.modifier_id = m.id
       AND m.group_id IS NULL
       AND m.name NOT ILIKE 'Оригинал:%'
       AND NOT (mim.modifier_id = ANY($2::int[]))`,
    [item.id, modifierIds]
  );

  if (card.serveIn) {
    await client.query('UPDATE menu_items SET serve_in = $2 WHERE id = $1', [item.id, card.serveIn]);
  }

  await client.query(
    `INSERT INTO drink_tech_card_applied (menu_item_id, card_id, version)
     VALUES ($1, $2, $3)
     ON CONFLICT (menu_item_id) DO UPDATE
     SET card_id = EXCLUDED.card_id, version = EXCLUDED.version, applied_at = now()`,
    [item.id, card.id, DRINK_TECH_CARD_VERSION]
  );
}

export async function ensureDrinkTechCards() {
  for (const sql of SCHEMA) {
    // kitchen_ticket_items появляется в ensureKitchenSchema, его нужно вызвать раньше.
    // eslint-disable-next-line no-await-in-loop
    await pool.query(sql);
  }

  const { rows: items } = await pool.query(
    `SELECT mi.id, mi.name, mc.name AS category_name,
            applied.version AS applied_version
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mc.id = mi.category_id
     LEFT JOIN drink_tech_card_applied applied ON applied.menu_item_id = mi.id
     WHERE mi.is_active = true`
  );

  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const card = matchDrinkCard(item.name, item.category_name);
      if (!card) continue;
      if (Number(item.applied_version) === DRINK_TECH_CARD_VERSION) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyCard(client, item, card);
      applied.push({ id: item.id, name: item.name, card: card.id, serveIn: card.serveIn });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (applied.length) {
    console.log(
      `Техкарты напитков: обновлено ${applied.length} — ${applied
        .map((row) => `${row.name} (${row.serveIn || 'без посуды'})`)
        .join('; ')}`
    );
  }
}

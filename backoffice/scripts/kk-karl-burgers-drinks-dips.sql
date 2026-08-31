-- Kebab King: состав бургеров + склад для напитков/дип-потов
-- Идемпотентно при повторном запуске.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Состав «Гамбургер» → целевые бургеры
--    «Двойной Гамбургер» в меню нет — копируем в «Двойной Чизбургер».
-- ---------------------------------------------------------------------------
INSERT INTO menu_item_modifiers (
  menu_item_id, modifier_id, is_default, price_override, qty_override, sort_order
)
SELECT t.target_id, mim.modifier_id, mim.is_default, mim.price_override, mim.qty_override, mim.sort_order
FROM menu_item_modifiers mim
CROSS JOIN (
  VALUES
    (107), -- Чизбургер
    (108), -- Двойной Чизбургер
    (110), -- Кебаб Бургер
    (109)  -- Чикенбургер
) AS t(target_id)
WHERE mim.menu_item_id = 106 -- Гамбургер
ON CONFLICT (menu_item_id, modifier_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Категории склада / групп модификаторов
-- ---------------------------------------------------------------------------
INSERT INTO warehouse_categories (name)
SELECT 'Бутилированная номенклатура'
WHERE NOT EXISTS (
  SELECT 1 FROM warehouse_categories WHERE name = 'Бутилированная номенклатура'
);

INSERT INTO warehouse_categories (name)
SELECT 'Дип-Поты'
WHERE NOT EXISTS (
  SELECT 1 FROM warehouse_categories WHERE name = 'Дип-Поты'
);

INSERT INTO modifier_groups (name)
SELECT 'Бутилированная номенклатура'
WHERE NOT EXISTS (
  SELECT 1 FROM modifier_groups WHERE name = 'Бутилированная номенклатура'
);

INSERT INTO modifier_groups (name)
SELECT 'Дип-Поты'
WHERE NOT EXISTS (
  SELECT 1 FROM modifier_groups WHERE name = 'Дип-Поты'
);

-- ---------------------------------------------------------------------------
-- 3) Напитки КК (кроме кофе): склад → модификатор → привязка к позиции
-- ---------------------------------------------------------------------------
INSERT INTO warehouse_items (category_id, name, unit)
SELECT wc.id, mi.name, 'pcs'
FROM menu_items mi
JOIN menu_categories mc ON mc.id = mi.category_id
CROSS JOIN warehouse_categories wc
WHERE wc.name = 'Бутилированная номенклатура'
  AND (mi.category_id = 39 OR mc.parent_id = 39)
  AND mi.category_id <> 40
  AND mi.name NOT ILIKE 'Кофе%'
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_items wi
    WHERE wi.name = mi.name AND wi.category_id = wc.id
  );

INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty)
SELECT mg.id, wi.name, 0, wi.id, 1
FROM warehouse_items wi
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Бутилированная номенклатура'
CROSS JOIN modifier_groups mg
WHERE mg.name = 'Бутилированная номенклатура'
  AND EXISTS (
    SELECT 1
    FROM menu_items mi
    JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE mi.name = wi.name
      AND (mi.category_id = 39 OR mc.parent_id = 39)
      AND mi.category_id <> 40
      AND mi.name NOT ILIKE 'Кофе%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM modifiers m
    WHERE m.warehouse_item_id = wi.id AND m.name = wi.name AND m.qty = 1 AND m.price = 0
  );

INSERT INTO menu_item_modifiers (menu_item_id, modifier_id, is_default, sort_order)
SELECT mi.id, m.id, true, 0
FROM menu_items mi
JOIN menu_categories mc ON mc.id = mi.category_id
JOIN warehouse_items wi ON wi.name = mi.name
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Бутилированная номенклатура'
JOIN modifiers m ON m.warehouse_item_id = wi.id AND m.name = wi.name AND m.qty = 1 AND m.price = 0
WHERE (mi.category_id = 39 OR mc.parent_id = 39)
  AND mi.category_id <> 40
  AND mi.name NOT ILIKE 'Кофе%'
ON CONFLICT (menu_item_id, modifier_id) DO NOTHING;

INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
SELECT v.venue_id, wi.id, 0, 0
FROM warehouse_items wi
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Бутилированная номенклатура'
CROSS JOIN (VALUES (4), (5)) AS v(venue_id)
ON CONFLICT (venue_id, warehouse_item_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Дип-Пот: склад → модификатор → привязка
-- ---------------------------------------------------------------------------
INSERT INTO warehouse_items (category_id, name, unit)
SELECT wc.id, mi.name, 'pcs'
FROM menu_items mi
CROSS JOIN warehouse_categories wc
WHERE wc.name = 'Дип-Поты'
  AND mi.category_id = 47
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_items wi
    WHERE wi.name = mi.name AND wi.category_id = wc.id
  );

INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty)
SELECT mg.id, wi.name, 0, wi.id, 1
FROM warehouse_items wi
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Дип-Поты'
CROSS JOIN modifier_groups mg
WHERE mg.name = 'Дип-Поты'
  AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.category_id = 47 AND mi.name = wi.name)
  AND NOT EXISTS (
    SELECT 1 FROM modifiers m
    WHERE m.warehouse_item_id = wi.id AND m.name = wi.name AND m.qty = 1 AND m.price = 0
  );

INSERT INTO menu_item_modifiers (menu_item_id, modifier_id, is_default, sort_order)
SELECT mi.id, m.id, true, 0
FROM menu_items mi
JOIN warehouse_items wi ON wi.name = mi.name
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Дип-Поты'
JOIN modifiers m ON m.warehouse_item_id = wi.id AND m.name = wi.name AND m.qty = 1 AND m.price = 0
WHERE mi.category_id = 47
ON CONFLICT (menu_item_id, modifier_id) DO NOTHING;

INSERT INTO venue_warehouse_stock (venue_id, warehouse_item_id, stock_qty, min_stock_qty)
SELECT v.venue_id, wi.id, 0, 0
FROM warehouse_items wi
JOIN warehouse_categories wc ON wc.id = wi.category_id AND wc.name = 'Дип-Поты'
CROSS JOIN (VALUES (4), (5)) AS v(venue_id)
ON CONFLICT (venue_id, warehouse_item_id) DO NOTHING;

COMMIT;

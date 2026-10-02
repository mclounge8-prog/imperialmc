-- KK: кетчуп / горчица / барбекю допом по 40₽ на шаурму и питы.
-- Тот же паттерн, что «Соус острый ШриРача» в группе «Соусы дополнительно»:
-- не включены по умолчанию, галочка, можно взять несколько.
-- Свободные «Кетчуп»/«Горчица» в группе «Соусы» не трогаем — это состав хот-догов.
-- Идемпотентно.

BEGIN;

INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty)
SELECT 7, 'Соус кетчуп', 40, 108, 0.090
WHERE NOT EXISTS (
  SELECT 1 FROM modifiers WHERE group_id = 7 AND name = 'Соус кетчуп'
);

INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty)
SELECT 7, 'Соус горчица', 40, 110, 0.090
WHERE NOT EXISTS (
  SELECT 1 FROM modifiers WHERE group_id = 7 AND name = 'Соус горчица'
);

INSERT INTO modifiers (group_id, name, price, warehouse_item_id, qty)
SELECT 7, 'Соус барбекю', 40, 157, 0.090
WHERE NOT EXISTS (
  SELECT 1 FROM modifiers WHERE group_id = 7 AND name = 'Соус барбекю'
);

UPDATE modifiers
SET price = 40,
    group_id = 7,
    warehouse_item_id = COALESCE(warehouse_item_id, 108),
    qty = CASE WHEN qty IS NULL OR qty = 0 THEN 0.090 ELSE qty END
WHERE name = 'Соус кетчуп' AND group_id = 7;

UPDATE modifiers
SET price = 40,
    group_id = 7,
    warehouse_item_id = COALESCE(warehouse_item_id, 110),
    qty = CASE WHEN qty IS NULL OR qty = 0 THEN 0.090 ELSE qty END
WHERE name = 'Соус горчица' AND group_id = 7;

UPDATE modifiers
SET price = 40,
    group_id = 7,
    warehouse_item_id = COALESCE(warehouse_item_id, 157),
    qty = CASE WHEN qty IS NULL OR qty = 0 THEN 0.090 ELSE qty END
WHERE name = 'Соус барбекю' AND group_id = 7;

INSERT INTO menu_item_modifiers (menu_item_id, modifier_id, is_default, sort_order)
SELECT mi.id, m.id, false, 10
FROM menu_items mi
JOIN menu_categories mc ON mc.id = mi.category_id
JOIN modifiers m ON m.group_id = 7
  AND m.name IN ('Соус кетчуп', 'Соус горчица', 'Соус барбекю')
WHERE mc.name = 'Шаурма'
  AND mi.name ILIKE 'Шаурма%'
ON CONFLICT (menu_item_id, modifier_id) DO UPDATE
SET is_default = EXCLUDED.is_default;

COMMIT;

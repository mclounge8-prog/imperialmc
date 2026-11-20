-- KK Октябрьская и Карла: ценник ноября 2026.
-- Шаурма и остальные позиции — новые цены матрицы ABC.
-- Френч-дог и луковые кольца 7шт снимаются с витрины, хот-дог остаётся.
-- Старые комбо выключаются, вместо них три новых.
-- Энергетики Tusa стоят в общей категории «Энергетики» (Октябрьская и Карла).
-- Повторный запуск безопасен.

BEGIN;

DO $$
DECLARE
  n int;
BEGIN
  UPDATE menu_items AS mi
  SET price = v.new_price
  FROM (VALUES
    (125, 'Шаурма Стандарт с курицей', 310::numeric, 350::numeric),
    (121, 'Шаурма Большая с курицей', 350, 400),
    (122, 'Шаурма Большая со свининой', 350, 400),
    (131, 'Картофель фри', 170, 200),
    (126, 'Шаурма Стандарт со свининой', 310, 350),
    (124, 'Шаурма Мини с курицей', 250, 280),
    (127, 'Шаурма Мини со свининой', 250, 310),
    (107, 'Чизбургер', 370, 440),
    (123, 'Шаурма в Пите с курицей', 360, 450),
    (109, 'Чикенбургер', 330, 390),
    (106, 'Гамбургер', 310, 360),
    (128, 'Шаурма в Пите со свининой', 360, 450),
    (108, 'Двойной Чизбургер', 430, 510),
    (110, 'Кебаб Бургер', 390, 470),
    (118, 'Хот-Дог', 240, 290),
    (141, 'Фреш Бар', 110, 130),
    (145, 'Кофе Капучино', 100, 120),
    (174, 'Липтон зеленый 0.5', 150, 170),
    (135, 'Крылышки 5шт', 340, 400),
    (164, 'Кола Classic 0.5', 100, 110),
    (154, 'Энергетик Drive', 150, 170),
    (111, 'Панини Классика', 280, 330),
    (115, 'Цезарь Ролл', 290, 340),
    (112, 'Панини мясная с курицей', 340, 400),
    (175, 'Липтон черный 0.5', 150, 170),
    (114, 'Панини мясная со свининой', 340, 400),
    (144, 'Кофе Американо', 100, 120),
    (147, 'Кофе Латте', 120, 140),
    (168, 'Сок Любимый Яблоко 0.2', 70, 80),
    (171, 'Вода аква минерале', 70, 80),
    (170, 'Сок Любимый Тропический микс 0.2', 70, 80),
    (165, 'Кола Литр Classic', 150, 170),
    (132, 'Крылышки 3шт', 200, 230),
    (172, 'Вода Черноголовка 0.5', 70, 80),
    (113, 'Бургер', 250, 290),
    (169, 'Сок любимый 1л', 210, 240),
    (143, 'Согревающий чай', 120, 140),
    (173, 'Вода Черноголовка 1л', 100, 120),
    (167, 'Кола Evervess 0.5', 100, 110),
    (166, 'Кола Два Литра Classic', 210, 240),
    (146, 'Кофе Капучино ванильный', 120, 140),
    (148, 'Кофе Эспрессо', 100, 120),
    (161, 'Энергетик Tornado', 130, 150),
    (162, 'Энергетик Tornado 2', 130, 150),
    (155, 'Энергетик Volt помело мята банан', 120, 140),
    (156, 'Энергетик Volt Сакура Персик', 120, 140),
    (157, 'Энергетик Volt - Сливовый пирог', 120, 140),
    (158, 'Энергетик Volt - Оригинал', 120, 140),
    (159, 'Энергетик Volt Гранат', 120, 140),
    (160, 'Энергетик Volt Кокос Манго', 120, 140),
    (163, 'Энергетик Адреналин 0.45', 180, 210)
  ) AS v(id, name, old_price, new_price)
  WHERE mi.id = v.id
    AND mi.name = v.name
    AND mi.price = v.old_price;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 51 AND n <> 0 THEN
    RAISE EXCEPTION 'Обновлено % цен вместо 51. Откат.', n;
  END IF;
END $$;

UPDATE menu_items
SET is_active = false
WHERE id = 117 AND name = 'Френч-Дог';

UPDATE menu_items
SET is_active = false
WHERE id = 138 AND name = 'Луковые кольца 7шт';

UPDATE menu_items
SET is_active = false
WHERE id IN (129, 130)
  AND name IN ('Комбо Шаурма стандарт', 'Комбо Семейный');

INSERT INTO menu_items (category_id, name, price, is_active)
SELECT 37, n.name, n.price, true
FROM (VALUES
  ('Комбо Стандарт', 600::numeric),
  ('Комбо Большой', 710::numeric),
  ('Комбо на двоих', 1010::numeric)
) AS n(name, price)
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items mi
  WHERE mi.category_id = 37 AND lower(mi.name) = lower(n.name)
);

UPDATE menu_items AS mi
SET price = n.price, is_active = true
FROM (VALUES
  ('Комбо Стандарт', 600::numeric),
  ('Комбо Большой', 710::numeric),
  ('Комбо на двоих', 1010::numeric)
) AS n(name, price)
WHERE mi.category_id = 37 AND lower(mi.name) = lower(n.name);

-- Tusa в общей категории «Энергетики»: её видят и Октябрьская, и Карла.
INSERT INTO menu_items (category_id, name, price, is_active)
SELECT 42, n.name, n.price, true
FROM (VALUES
  ('Энергетик 0,5л Tusa', 120::numeric),
  ('Энергетик 1л Tusa', 180::numeric),
  ('Энергетик Pulse Up', 130::numeric)
) AS n(name, price)
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items mi
  WHERE lower(mi.name) = lower(n.name)
    AND mi.category_id IN (
      SELECT id FROM menu_categories WHERE name IN ('Энергетики', 'Энергетики Tusa')
    )
);

UPDATE menu_items AS mi
SET category_id = 42, price = n.price, is_active = true
FROM (VALUES
  ('Энергетик 0,5л Tusa', 120::numeric),
  ('Энергетик 1л Tusa', 180::numeric),
  ('Энергетик Pulse Up', 130::numeric)
) AS n(name, price)
WHERE lower(mi.name) = lower(n.name)
  AND mi.category_id IN (
    SELECT id FROM menu_categories WHERE name IN ('Энергетики', 'Энергетики Tusa')
  );

DELETE FROM venue_hidden_menu_categories
WHERE category_id IN (
  SELECT id FROM menu_categories WHERE name = 'Энергетики Tusa'
);

DELETE FROM menu_categories
WHERE name = 'Энергетики Tusa'
  AND NOT EXISTS (
    SELECT 1 FROM menu_items mi WHERE mi.category_id = menu_categories.id
  );

COMMIT;

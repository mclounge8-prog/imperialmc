-- Импорт меню Kebab King из номенклатуры QuickResto.
-- Категории и позиции создаются глобально; видимость только у
-- «Kebab King Октябрьская» и «Kebab King Карла» (остальным заведениям
-- категории добавляются в venue_hidden_menu_categories).
-- Идемпотентно: повторный запуск не дублирует категории/позиции.

BEGIN;

CREATE TEMP TABLE kk_cat_map (
  path text PRIMARY KEY,
  id   int NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.kk_ensure_category(
  p_name text,
  p_parent_id int,
  p_icon text,
  p_sort int,
  p_path text
) RETURNS int AS $$
DECLARE
  v_id int;
BEGIN
  SELECT id INTO v_id FROM kk_cat_map WHERE path = p_path;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF p_parent_id IS NULL THEN
    SELECT id INTO v_id
    FROM menu_categories
    WHERE parent_id IS NULL AND lower(name) = lower(p_name)
    LIMIT 1;
  ELSE
    SELECT id INTO v_id
    FROM menu_categories
    WHERE parent_id = p_parent_id AND lower(name) = lower(p_name)
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO menu_categories (name, icon, sort_order, parent_id)
    VALUES (p_name, p_icon, p_sort, p_parent_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE menu_categories
    SET icon = COALESCE(icon, p_icon),
        sort_order = p_sort
    WHERE id = v_id;
  END IF;

  INSERT INTO kk_cat_map (path, id) VALUES (p_path, v_id)
  ON CONFLICT (path) DO UPDATE SET id = EXCLUDED.id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.kk_upsert_item(
  p_category_id int,
  p_name text,
  p_price numeric,
  p_active boolean
) RETURNS void AS $$
DECLARE
  v_id int;
BEGIN
  SELECT id INTO v_id
  FROM menu_items
  WHERE category_id = p_category_id AND lower(name) = lower(p_name)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO menu_items (category_id, name, price, is_active)
    VALUES (p_category_id, p_name, p_price, p_active);
  ELSE
    UPDATE menu_items
    SET price = p_price,
        is_active = p_active
    WHERE id = v_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  c_burgers int;
  c_rolls int;
  c_shawarma int;
  c_combo int;
  c_sides int;
  c_drinks int;
  c_coffee int;
  c_natakhtari int;
  c_energy int;
  c_cola int;
  c_juice int;
  c_water int;
  c_tea_bot int;
BEGIN
  c_burgers  := pg_temp.kk_ensure_category('Бургеры и сэндвичи', NULL, '🍔', 20, 'Бургеры и сэндвичи');
  c_rolls    := pg_temp.kk_ensure_category('Роллы и хот-доги', NULL, '🌭', 21, 'Роллы и хот-доги');
  c_shawarma := pg_temp.kk_ensure_category('Шаурма', NULL, '🌯', 22, 'Шаурма');
  c_combo    := pg_temp.kk_ensure_category('Комбо-наборы', NULL, '🍱', 23, 'Комбо-наборы');
  c_sides    := pg_temp.kk_ensure_category('Закуски и гарниры', NULL, '🍟', 24, 'Закуски и гарниры');
  c_drinks   := pg_temp.kk_ensure_category('Напитки КК', NULL, '🥤', 25, 'Напитки КК');

  c_coffee     := pg_temp.kk_ensure_category('Кофе в кофемашине', c_drinks, NULL, 1, 'Напитки КК → Кофе в кофемашине');
  c_natakhtari := pg_temp.kk_ensure_category('Натахтари', c_drinks, NULL, 2, 'Напитки КК → Натахтари');
  c_energy     := pg_temp.kk_ensure_category('Энергетики', c_drinks, NULL, 3, 'Напитки КК → Энергетики');
  c_cola       := pg_temp.kk_ensure_category('Кола', c_drinks, NULL, 4, 'Напитки КК → Кола');
  c_juice      := pg_temp.kk_ensure_category('Соки', c_drinks, NULL, 5, 'Напитки КК → Соки');
  c_water      := pg_temp.kk_ensure_category('Вода', c_drinks, NULL, 6, 'Напитки КК → Вода');
  c_tea_bot    := pg_temp.kk_ensure_category('Чай бутилированный', c_drinks, NULL, 7, 'Напитки КК → Чай бутилированный');

  -- Бургеры
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Гамбургер', 310, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Чизбургер', 370, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Двойной Чизбургер', 430, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Чикенбургер', 330, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Кебаб Бургер', 390, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Панини Классика', 280, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Панини мясная с курицей', 340, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Бургер', 250, true);
  PERFORM pg_temp.kk_upsert_item(c_burgers, 'Панини мясная со свининой', 340, true);

  -- Роллы
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Цезарь Ролл', 290, true);
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Рап', 240, false);
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Френч-Дог', 250, true);
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Хот-Дог', 240, true);
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Корн-Дог', 200, false);
  PERFORM pg_temp.kk_upsert_item(c_rolls, 'Корн-Дог с сыром', 200, false);

  -- Шаурма
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Большая с курицей', 350, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Большая со свининой', 350, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма в Пите с курицей', 360, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Мини с курицей', 250, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Стандарт с курицей', 310, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Стандарт со свининой', 310, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма Мини со свининой', 250, true);
  PERFORM pg_temp.kk_upsert_item(c_shawarma, 'Шаурма в Пите со свининой', 360, true);

  -- Комбо
  PERFORM pg_temp.kk_upsert_item(c_combo, 'Комбо Шаурма стандарт', 550, true);
  PERFORM pg_temp.kk_upsert_item(c_combo, 'Комбо Семейный', 999, true);

  -- Закуски
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Картофель фри', 170, true);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Крылышки 3шт', 200, true);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Наггетсы 5шт', 250, false);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Медальоны сырные 5шт', 280, false);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Крылышки 5шт', 340, true);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Медальоны сырные 7шт', 350, false);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Наггетсы 7шт', 310, false);
  PERFORM pg_temp.kk_upsert_item(c_sides, 'Луковые кольца 7шт', 150, true);

  -- Напитки КК (корень)
  PERFORM pg_temp.kk_upsert_item(c_drinks, 'Кофе 3 в 1', 50, true);
  PERFORM pg_temp.kk_upsert_item(c_drinks, 'Чай', 30, true);
  PERFORM pg_temp.kk_upsert_item(c_drinks, 'Фреш Бар', 110, true);
  PERFORM pg_temp.kk_upsert_item(c_drinks, 'Кофе черный', 40, true);
  PERFORM pg_temp.kk_upsert_item(c_drinks, 'Согревающий чай', 120, true);

  -- Кофе в кофемашине
  PERFORM pg_temp.kk_upsert_item(c_coffee, 'Кофе Американо', 100, true);
  PERFORM pg_temp.kk_upsert_item(c_coffee, 'Кофе Капучино', 100, true);
  PERFORM pg_temp.kk_upsert_item(c_coffee, 'Кофе Капучино ванильный', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_coffee, 'Кофе Латте', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_coffee, 'Кофе Эспрессо', 100, true);

  -- Натахтари
  PERFORM pg_temp.kk_upsert_item(c_natakhtari, 'Натахтари виноград 0.5', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_natakhtari, 'Натахтари груша 0.5', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_natakhtari, 'Натахтари лимон-лайм', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_natakhtari, 'Натахтари тархун', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_natakhtari, 'Натахтари фейхоа', 130, true);

  -- Энергетики
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Drive', 150, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt помело мята банан', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt Сакура Персик', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt - Сливовый пирог', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt - Оригинал', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt Гранат', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Volt Кокос Манго', 120, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Tornado', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Tornado 2', 130, true);
  PERFORM pg_temp.kk_upsert_item(c_energy, 'Энергетик Адреналин 0.45', 180, true);

  -- Кола
  PERFORM pg_temp.kk_upsert_item(c_cola, 'Кола Classic 0.5', 100, true);
  PERFORM pg_temp.kk_upsert_item(c_cola, 'Кола Литр Classic', 150, true);
  PERFORM pg_temp.kk_upsert_item(c_cola, 'Кола Два Литра Classic', 210, true);
  PERFORM pg_temp.kk_upsert_item(c_cola, 'Кола Evervess 0.5', 100, true);

  -- Соки
  PERFORM pg_temp.kk_upsert_item(c_juice, 'Сок Любимый Яблоко 0.2', 70, true);
  PERFORM pg_temp.kk_upsert_item(c_juice, 'Сок любимый 1л', 210, true);
  PERFORM pg_temp.kk_upsert_item(c_juice, 'Сок Любимый Тропический микс 0.2', 70, true);

  -- Вода
  PERFORM pg_temp.kk_upsert_item(c_water, 'Вода аква минерале', 70, true);
  PERFORM pg_temp.kk_upsert_item(c_water, 'Вода Черноголовка 0.5', 70, true);
  PERFORM pg_temp.kk_upsert_item(c_water, 'Вода Черноголовка 1л', 100, true);

  -- Чай бутилированный
  PERFORM pg_temp.kk_upsert_item(c_tea_bot, 'Липтон зеленый 0.5', 150, true);
  PERFORM pg_temp.kk_upsert_item(c_tea_bot, 'Липтон черный 0.5', 150, true);
END $$;

-- Скрыть все KK-категории (корни + подкатегории) у заведений, кроме KK.
INSERT INTO venue_hidden_menu_categories (venue_id, category_id)
SELECT v.id, m.id
FROM venues v
CROSS JOIN kk_cat_map m
WHERE v.name NOT IN ('Kebab King Октябрьская', 'Kebab King Карла')
ON CONFLICT DO NOTHING;

COMMIT;

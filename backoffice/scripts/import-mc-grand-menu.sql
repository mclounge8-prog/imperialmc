-- Меню MC Гранд: категории (уже есть id 53–63), иконки, позиции, видимость.
-- Идемпотентно: повторный запуск обновляет цены/иконки, не плодит дубли.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.grand_upsert_item(
  p_category_id int,
  p_name text,
  p_price numeric
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
    VALUES (p_category_id, p_name, p_price, true);
  ELSE
    UPDATE menu_items
    SET price = p_price, is_active = true
    WHERE id = v_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Иконки и порядок корневых / подкатегорий Гранда
UPDATE menu_categories SET icon = '🍳', sort_order = 100, name = 'Завтраки'
WHERE id = 53;
UPDATE menu_categories SET icon = '🥗', sort_order = 110, name = 'Салаты'
WHERE id = 54;
UPDATE menu_categories SET icon = '🍕', sort_order = 120, name = 'Пицца'
WHERE id = 55;
UPDATE menu_categories SET icon = '🍽️', sort_order = 130, name = 'Блюда и закуски'
WHERE id = 56;
UPDATE menu_categories SET icon = '🍰', sort_order = 140, name = 'Десерты'
WHERE id = 57;
UPDATE menu_categories SET icon = '🥤', sort_order = 150, name = 'Напитки ГРАНТ'
WHERE id = 58;

UPDATE menu_categories SET icon = '☕', sort_order = 1, name = 'Кофе', parent_id = 58
WHERE id = 59;
UPDATE menu_categories SET icon = '🍵', sort_order = 2, name = 'Чай 1л', parent_id = 58
WHERE id = 60;
UPDATE menu_categories SET icon = '✨', sort_order = 3, name = 'Авторский чай', parent_id = 58
WHERE id = 61;
UPDATE menu_categories SET icon = '🥛', sort_order = 4, name = 'Милкшейки', parent_id = 58
WHERE id = 62;
UPDATE menu_categories SET icon = '🍋', sort_order = 5, name = 'Лимонады', parent_id = 58
WHERE id = 63;

-- Завтраки (53)
SELECT pg_temp.grand_upsert_item(53, 'Яичница-глазунья, тост с ветчиной и сыром, чай', 280);
SELECT pg_temp.grand_upsert_item(53, 'Омлет классический, тост с ветчиной, чай', 250);
SELECT pg_temp.grand_upsert_item(53, 'Омлет с зеленью, сыром Моцарелла и черри, тост, чай', 280);
SELECT pg_temp.grand_upsert_item(53, 'Сэндвич с ветчиной, сыром и свежими овощами', 220);
SELECT pg_temp.grand_upsert_item(53, 'Сэндвич с курицей, беконом и свежими овощами', 250);

-- Салаты (54)
SELECT pg_temp.grand_upsert_item(54, 'Цезарь с курицей', 360);
SELECT pg_temp.grand_upsert_item(54, 'Цезарь с тигровыми креветками', 430);
SELECT pg_temp.grand_upsert_item(54, 'Французский', 350);
SELECT pg_temp.grand_upsert_item(54, 'Греческий', 330);

-- Пицца (55)
SELECT pg_temp.grand_upsert_item(55, 'Пепперони', 750);
SELECT pg_temp.grand_upsert_item(55, 'Мясная', 790);
SELECT pg_temp.grand_upsert_item(55, 'Хачапури по-аджарски', 500);

-- Блюда и закуски (56)
SELECT pg_temp.grand_upsert_item(56, 'Паста карбонара', 370);
SELECT pg_temp.grand_upsert_item(56, 'Паста фетучини с курицей и грибами', 420);
SELECT pg_temp.grand_upsert_item(56, 'Чебурек', 100);
SELECT pg_temp.grand_upsert_item(56, 'Онигири со снежным крабом', 180);
SELECT pg_temp.grand_upsert_item(56, 'Картофель фри', 200);
SELECT pg_temp.grand_upsert_item(56, 'Нагетсы', 270);

-- Десерты (57)
SELECT pg_temp.grand_upsert_item(57, 'Чизкейк Нью-Йорк', 210);
SELECT pg_temp.grand_upsert_item(57, 'Чизкейк Сникерс', 230);
SELECT pg_temp.grand_upsert_item(57, 'Чизкейк Фисташковый', 220);

-- Кофе (59)
SELECT pg_temp.grand_upsert_item(59, 'Эспрессо', 140);
SELECT pg_temp.grand_upsert_item(59, 'Американо', 150);
SELECT pg_temp.grand_upsert_item(59, 'Капучино', 180);
SELECT pg_temp.grand_upsert_item(59, 'Флэт Уайт', 190);
SELECT pg_temp.grand_upsert_item(59, 'Горячий Шоколад', 180);
SELECT pg_temp.grand_upsert_item(59, 'Латте', 190);
SELECT pg_temp.grand_upsert_item(59, 'Латте-синнабон', 210);
SELECT pg_temp.grand_upsert_item(59, 'Раф Лавандовый', 210);
SELECT pg_temp.grand_upsert_item(59, 'Раф Bubble gum', 210);

-- Чай 1л (60)
SELECT pg_temp.grand_upsert_item(60, 'Грезы султана', 250);
SELECT pg_temp.grand_upsert_item(60, 'Лимонник', 250);
SELECT pg_temp.grand_upsert_item(60, 'Глинтвейн', 420);
SELECT pg_temp.grand_upsert_item(60, 'Таежный', 250);

-- Авторский чай (61)
SELECT pg_temp.grand_upsert_item(61, 'Зеленый цитрусовый с гуавой', 320);
SELECT pg_temp.grand_upsert_item(61, 'Клюквенный с тимьяном', 390);
SELECT pg_temp.grand_upsert_item(61, 'Облепиховый с имбирем', 350);
SELECT pg_temp.grand_upsert_item(61, 'Ромашковый с медовым персиком', 350);

-- Милкшейки (62)
SELECT pg_temp.grand_upsert_item(62, 'Пина колада', 330);
SELECT pg_temp.grand_upsert_item(62, 'Тропический', 340);
SELECT pg_temp.grand_upsert_item(62, 'Ванильная жвачка', 320);
SELECT pg_temp.grand_upsert_item(62, 'M&MS', 380);
SELECT pg_temp.grand_upsert_item(62, 'Bounty', 380);
SELECT pg_temp.grand_upsert_item(62, 'Snickers', 380);
SELECT pg_temp.grand_upsert_item(62, 'Клубничный барбарис', 350);
SELECT pg_temp.grand_upsert_item(62, 'Карамелька', 340);

-- Лимонады (63)
SELECT pg_temp.grand_upsert_item(63, 'Апельсин-манго', 270);
SELECT pg_temp.grand_upsert_item(63, 'Румба', 270);
SELECT pg_temp.grand_upsert_item(63, 'Клубничная-жвачка', 250);
SELECT pg_temp.grand_upsert_item(63, 'Мохито', 300);
SELECT pg_temp.grand_upsert_item(63, 'Электро-Колада', 290);
-- В милкшейках уже есть «Тропический» — для лимонадов уточняем название, чтобы не путать при поиске.
SELECT pg_temp.grand_upsert_item(63, 'Тропический', 270);

-- Скрыть категории Гранда у всех заведений, кроме MC Гранд
INSERT INTO venue_hidden_menu_categories (venue_id, category_id)
SELECT v.id, c.id
FROM venues v
CROSS JOIN menu_categories c
WHERE v.name <> 'MC Гранд'
  AND (
    c.id IN (53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63)
    OR c.parent_id IN (53, 54, 55, 56, 57, 58)
  )
ON CONFLICT DO NOTHING;

COMMIT;

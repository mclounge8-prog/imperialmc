-- ============================================================
-- Imperial MC — бэкофис MVP: базовая схема БД (PostgreSQL)
-- ============================================================

-- Администраторы бэкофиса (вход по логину/паролю в веб-панель)
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'admin', -- admin, manager
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Заведения (точки продаж) — у каждой свой склад (остатки), свои столы, назначенные сотрудники
CREATE TABLE IF NOT EXISTS venues (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  address    VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Сотрудники (вход на Android-терминал по PIN-коду)
CREATE TABLE IF NOT EXISTS staff (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  role        VARCHAR(30) NOT NULL,        -- bartender, hookah_master, waiter
  pin_hash    VARCHAR(255) NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Сотрудник ↔ заведение: один сотрудник может быть назначен на несколько точек сразу
CREATE TABLE IF NOT EXISTS staff_venues (
  staff_id INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  venue_id INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_venues_venue ON staff_venues(venue_id);

-- Зоны заведения (зал, терраса и т.д.) — привязаны к конкретному заведению
CREATE TABLE IF NOT EXISTS zones (
  id        SERIAL PRIMARY KEY,
  venue_id  INT REFERENCES venues(id) ON DELETE CASCADE,
  name      VARCHAR(100) NOT NULL
);

-- Столы
CREATE TABLE IF NOT EXISTS tables (
  id        SERIAL PRIMARY KEY,
  zone_id   INT REFERENCES zones(id) ON DELETE CASCADE,
  name      VARCHAR(50) NOT NULL,           -- напр. "Стол 5"
  capacity  INT DEFAULT 4,
  pos_x     INT DEFAULT 0,                  -- координаты под визуальную схему зала
  pos_y     INT DEFAULT 0,
  status    VARCHAR(20) NOT NULL DEFAULT 'free' -- free, occupied, dirty
);

-- Категории складской номенклатуры (Табак, Уголь, Бар-ингредиенты...) — общие на все заведения
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL
);

-- Складская номенклатура (каталог, общий для всех заведений — конкретный остаток
-- см. venue_warehouse_stock ниже, там же и списание при продаже)
CREATE TABLE IF NOT EXISTS warehouse_items (
  id             SERIAL PRIMARY KEY,
  category_id    INT REFERENCES warehouse_categories(id),
  name           VARCHAR(150) NOT NULL,     -- напр. "Табак Tangiers Мята"
  unit           VARCHAR(10) NOT NULL,      -- g, ml, pcs
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Остаток конкретной складской позиции в конкретном заведении —
-- источник истины для отображения в бэкофисе и для списания при продаже
CREATE TABLE IF NOT EXISTS venue_warehouse_stock (
  venue_id          INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  warehouse_item_id INT NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  stock_qty         NUMERIC(12,3) NOT NULL DEFAULT 0,
  min_stock_qty     NUMERIC(12,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (venue_id, warehouse_item_id)
);

-- Категории меню (Кальяны, Бар...)
CREATE TABLE IF NOT EXISTS menu_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  icon        VARCHAR(10),
  sort_order  INT DEFAULT 0
);

-- Позиции меню (то, что продаётся гостю) — общие для всех заведений
CREATE TABLE IF NOT EXISTS menu_items (
  id           SERIAL PRIMARY KEY,
  category_id  INT REFERENCES menu_categories(id),
  name         VARCHAR(150) NOT NULL,
  price        NUMERIC(10,2) NOT NULL,
  image_url    VARCHAR(500),
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Рецептура (legacy): что и сколько списывается со склада при продаже 1 позиции
-- меню. Больше не используется приложением — данные один раз перенесены в
-- modifiers/menu_item_modifiers ниже (см. миграцию в конце файла), таблица
-- оставлена только как историческая читаемая копия, на неё больше не пишут.
CREATE TABLE IF NOT EXISTS menu_item_recipe (
  id                 SERIAL PRIMARY KEY,
  menu_item_id       INT REFERENCES menu_items(id) ON DELETE CASCADE,
  warehouse_item_id  INT REFERENCES warehouse_items(id),
  qty                NUMERIC(10,3) NOT NULL -- напр. 20.000 (г табака на 1 кальян)
);

-- ============================================================
-- Модификаторы — единая система ингредиентов и добавок для позиций меню.
-- Заменяет старую рецептуру: теперь у каждого пункта состава есть цена
-- (0 для обычного ингредиента, >0 для платной добавки) и его можно
-- включать/выключать прямо на терминале при оформлении заказа, а не только
-- через жёсткую тех-карту.
-- ============================================================

-- Группы — задают ограничение выбора для набора модификаторов конкретной
-- позиции (напр. "Лаваш": ровно 1 вариант; "Соусы": не больше 2).
-- Обычные ингредиенты блюда группе не принадлежат (group_id IS NULL у
-- modifiers) — на них ограничение выбора не действует, это просто список
-- галочек "входит / не входит".
CREATE TABLE IF NOT EXISTS modifier_groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT, -- NULL = без ограничения сверху
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Каталог модификаторов — общий на все позиции меню (переиспользуется,
-- как warehouse_items), с ценой по умолчанию и опциональным списанием со
-- склада. Конкретная позиция меню может переопределить цену/количество
-- списания через menu_item_modifiers ниже.
CREATE TABLE IF NOT EXISTS modifiers (
  id                SERIAL PRIMARY KEY,
  group_id          INT REFERENCES modifier_groups(id) ON DELETE SET NULL,
  name              VARCHAR(150) NOT NULL,
  price             NUMERIC(10,2) NOT NULL DEFAULT 0,
  warehouse_item_id INT REFERENCES warehouse_items(id) ON DELETE SET NULL,
  qty               NUMERIC(10,3) NOT NULL DEFAULT 0, -- списание при выборе; 0 = не списывается
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Привязка модификатора к конкретной позиции меню: is_default — включён
-- автоматически при добавлении позиции в заказ (можно снять на терминале),
-- *_override — переопределение цены/количества списания именно для этой
-- позиции (NULL — берётся значение по умолчанию из modifiers).
CREATE TABLE IF NOT EXISTS menu_item_modifiers (
  id             SERIAL PRIMARY KEY,
  menu_item_id   INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  modifier_id    INT NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  price_override NUMERIC(10,2),
  qty_override   NUMERIC(10,3),
  sort_order     INT NOT NULL DEFAULT 0,
  UNIQUE (menu_item_id, modifier_id)
);

-- Снапшот выбранных модификаторов конкретной позиции живого заказа — цена,
-- название и данные для списания зафиксированы на момент добавления в заказ
-- (тот же принцип, что и в order_items: изменения каталога потом не должны
-- задним числом менять уже оформленный заказ).
CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id                SERIAL PRIMARY KEY,
  order_item_id     INT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id       INT REFERENCES modifiers(id) ON DELETE SET NULL,
  name              VARCHAR(150) NOT NULL,
  price             NUMERIC(10,2) NOT NULL DEFAULT 0,
  warehouse_item_id INT REFERENCES warehouse_items(id) ON DELETE SET NULL,
  qty               NUMERIC(10,3) NOT NULL DEFAULT 0
);

-- Снапшот модификаторов уже рассчитанного чека — для истории/будущих отчётов
-- по составу продаж (тот же принцип, что и receipt_items). modifier_id — не
-- просто снапшот имени, а ссылка на каталог: нужна, чтобы на терминале можно
-- было сравнить состав чека с ТЕКУЩИМИ настройками позиции меню и показать,
-- что из состава по умолчанию убрали, а что докупили сверху.
CREATE TABLE IF NOT EXISTS receipt_item_modifiers (
  id               SERIAL PRIMARY KEY,
  receipt_item_id  INT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  modifier_id      INT REFERENCES modifiers(id) ON DELETE SET NULL,
  name             VARCHAR(150) NOT NULL,
  price            NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers(group_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_item ON menu_item_modifiers(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON order_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS idx_receipt_item_modifiers_item ON receipt_item_modifiers(receipt_item_id);

-- Заказы: table_id = NULL означает "быстрый заказ" (не привязан к столу).
-- venue_id определяется через стол (стол → зона → заведение) при открытии,
-- либо указывается явно для быстрого заказа — нужен, чтобы знать, чей склад списывать.
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  table_id    INT REFERENCES tables(id) ON DELETE SET NULL,
  venue_id    INT REFERENCES venues(id) ON DELETE SET NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'open', -- open, paid, cancelled
  opened_by   INT REFERENCES staff(id) ON DELETE SET NULL,
  opened_at   TIMESTAMPTZ DEFAULT now(),
  closed_at   TIMESTAMPTZ
);

-- Гости внутри заказа — отдельные "чеки" для разделения счёта. У каждого заказа
-- по умолчанию один гость ("Гость 1"), добавление новых — по кнопке на терминале.
-- Гости внутри заказа — отдельные "чеки" для разделения счёта. У каждого заказа
-- по умолчанию один гость ("Гость 1"), добавление новых — по кнопке на терминале.
-- Статус — своя оплата/закрытие на гостя: весь заказ (и стол) закрывается только
-- когда рассчитаны ВСЕ гости, а не когда закрыт один из нескольких.
CREATE TABLE IF NOT EXISTS order_guests (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label      VARCHAR(50) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'open', -- open, paid, cancelled
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Позиции заказа: название и цена копируются на момент продажи —
-- если потом поменяют цену в меню, старые чеки не должны "задним числом" измениться
CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  guest_id      INT REFERENCES order_guests(id) ON DELETE SET NULL,
  menu_item_id  INT REFERENCES menu_items(id) ON DELETE SET NULL,
  name          VARCHAR(150) NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  qty           INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Смены (кассовые смены) — задел под будущую интеграцию с кассами АТОЛ:
-- там открытие/закрытие смены и X/Z-отчёты обязательны по 54-ФЗ. Пока это
-- просто группировка чеков во времени для терминала (без реальной фискализации).
-- ============================================================

CREATE TABLE IF NOT EXISTS shifts (
  id             SERIAL PRIMARY KEY,
  venue_id       INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'open', -- open, closed
  opened_by      INT REFERENCES staff(id) ON DELETE SET NULL,
  opened_by_name VARCHAR(100),  -- снапшот имени на момент открытия
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by      INT REFERENCES staff(id) ON DELETE SET NULL,
  closed_by_name VARCHAR(100),  -- снапшот имени на момент закрытия
  closed_at      TIMESTAMPTZ,
  receipts_count INT,           -- снапшот на момент закрытия (для открытой считаем live)
  revenue_total  NUMERIC(10,2)  -- снапшот на момент закрытия
);

CREATE INDEX IF NOT EXISTS idx_shifts_venue_status ON shifts(venue_id, status);
-- На уровне БД гарантируем, что у заведения не может быть двух открытых смен одновременно
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_venue ON shifts(venue_id) WHERE status = 'open';

-- ============================================================
-- Чеки — постоянная историческая запись каждого рассчитанного гостя/чека.
-- Снапшотит venue/стол/гостя/сотрудника/позиции на момент расчёта: если потом
-- переименуют категорию, удалят стол или сотрудника — история чеков не исказится
-- и не сломается задним числом. Это основа для будущей статистики продаж.
-- ============================================================

CREATE TABLE IF NOT EXISTS receipts (
  id           SERIAL PRIMARY KEY,
  venue_id     INT NOT NULL REFERENCES venues(id),
  order_id     INT REFERENCES orders(id) ON DELETE SET NULL,
  guest_id     INT REFERENCES order_guests(id) ON DELETE SET NULL,
  table_id     INT REFERENCES tables(id) ON DELETE SET NULL,
  table_name   VARCHAR(50),   -- снапшот — стол мог быть переименован/удалён позже
  guest_label  VARCHAR(50),   -- снапшот "Гость 1" и т.п.
  staff_id     INT REFERENCES staff(id) ON DELETE SET NULL,
  staff_name   VARCHAR(100),  -- снапшот имени сотрудника, рассчитавшего чек
  status       VARCHAR(20) NOT NULL, -- paid, cancelled
  subtotal     NUMERIC(10,2) NOT NULL,
  discount     NUMERIC(10,2) NOT NULL DEFAULT 0, -- задел под будущие скидки
  total        NUMERIC(10,2) NOT NULL,
  opened_at    TIMESTAMPTZ,           -- когда открыли стол/заказ
  closed_at    TIMESTAMPTZ NOT NULL DEFAULT now() -- когда рассчитали этот чек
);

-- Позиции чека — снапшот того, что было продано (не ссылка на живой order_items,
-- который может измениться или быть удалён)
CREATE TABLE IF NOT EXISTS receipt_items (
  id             SERIAL PRIMARY KEY,
  receipt_id     INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  menu_item_id   INT REFERENCES menu_items(id) ON DELETE SET NULL,
  name           VARCHAR(150) NOT NULL,
  category_id    INT REFERENCES menu_categories(id) ON DELETE SET NULL,
  category_name  VARCHAR(100), -- снапшот — для отчётов по категориям даже если её переименуют/удалят
  price          NUMERIC(10,2) NOT NULL,
  qty            INT NOT NULL,
  line_total     NUMERIC(10,2) NOT NULL
);

-- Способы оплаты чека — отдельной таблицей, а не полем в receipts: сразу
-- поддерживает разделённую оплату (часть наличными + часть картой одним чеком)
-- без будущей переделки схемы. Банковские поля — задел под реальную интеграцию
-- с эквайринговым терминалом (Атол/банк), пока не заполняются автоматически.
CREATE TABLE IF NOT EXISTS receipt_payments (
  id           SERIAL PRIMARY KEY,
  receipt_id   INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  method       VARCHAR(20) NOT NULL, -- cash, card, other
  amount       NUMERIC(10,2) NOT NULL,
  card_last4   VARCHAR(4),
  card_brand   VARCHAR(30),  -- Visa, Mastercard, МИР...
  auth_code    VARCHAR(20),  -- код авторизации банка
  rrn          VARCHAR(20),  -- Reference Retrieval Number эквайера
  terminal_id  VARCHAR(30),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_venue_closed ON receipts(venue_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payments_receipt ON receipt_payments(receipt_id);

-- Видимость категорий меню по заведениям: присутствие строки = категория СКРЫТА
-- в этом заведении. По умолчанию (нет строки) — категория видна везде.
-- Опрокидывать удобнее так: у большинства заведений большинство категорий нужны,
-- проще явно отметить исключения, чем включать всё по одной.
CREATE TABLE IF NOT EXISTS venue_hidden_menu_categories (
  venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, category_id)
);

-- Устройства (Android-терминалы), зарегистрированные через код из бэкофиса.
-- Управление централизованное: назначение на заведение и активация/деактивация —
-- через бэкофис, без физического доступа к самому планшету.
CREATE TABLE IF NOT EXISTS devices (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100),
  venue_id      INT REFERENCES venues(id) ON DELETE SET NULL,
  token_hash    VARCHAR(255) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

-- Одноразовые короткие коды для регистрации нового устройства
CREATE TABLE IF NOT EXISTS device_registration_codes (
  code       VARCHAR(10) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

-- Индексы для частых выборок
CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_tables_zone ON tables(zone_id);
CREATE INDEX IF NOT EXISTS idx_zones_venue ON zones(venue_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_category ON warehouse_items(category_id);
CREATE INDEX IF NOT EXISTS idx_recipe_menu_item ON menu_item_recipe(menu_item_id);

-- ============================================================
-- Миграции для БД, где эти таблицы уже существовали из прошлых версий
-- (CREATE TABLE IF NOT EXISTS их не трогает, поэтому добавляем явно —
-- ALTER здесь идемпотентны, безопасно перезапускать сколько угодно раз)
-- ============================================================
ALTER TABLE zones ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE warehouse_items DROP COLUMN IF EXISTS stock_qty;
ALTER TABLE warehouse_items DROP COLUMN IF EXISTS min_stock_qty;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS guest_id INT REFERENCES order_guests(id) ON DELETE SET NULL;
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS icon VARCHAR(10);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE order_guests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS shift_id INT REFERENCES shifts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_shift ON receipts(shift_id);

-- ============================================================
-- Разовый перенос старой рецептуры (menu_item_recipe) в новую систему
-- модификаторов — сама рецептура становится обычными "включёнными по
-- умолчанию" ингредиентами без группы (без ограничения выбора), с ценой 0
-- и с тем же количеством списания, что было раньше (сохраняем через
-- qty_override, а не через каталожное значение — у одного и того же сырья
-- расход мог отличаться по разным позициям меню). Оба запроса безопасно
-- перезапускать: WHERE NOT EXISTS не даёт создать дубликаты при повторном
-- прогоне этого файла на уже мигрированной базе.
-- ============================================================
INSERT INTO modifiers (name, warehouse_item_id, price, qty)
SELECT DISTINCT wi.name, wi.id, 0, 0
FROM menu_item_recipe mir
JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id
WHERE NOT EXISTS (
  SELECT 1 FROM modifiers m WHERE m.warehouse_item_id = wi.id AND m.group_id IS NULL
);

INSERT INTO menu_item_modifiers (menu_item_id, modifier_id, is_default, qty_override)
SELECT mir.menu_item_id, m.id, true, mir.qty
FROM menu_item_recipe mir
JOIN modifiers m ON m.warehouse_item_id = mir.warehouse_item_id AND m.group_id IS NULL
WHERE mir.menu_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM menu_item_modifiers mim
    WHERE mim.menu_item_id = mir.menu_item_id AND mim.modifier_id = m.id
  );

-- Доливка снапшотов для УЖЕ СУЩЕСТВУЮЩИХ позиций заказов (в т.ч. открытых на
-- момент этого деплоя) — без неё удаление такой позиции после обновления не
-- вернёт списанное сырьё на склад, потому что новый код читает остаток для
-- возврата из order_item_modifiers, а не из старой рецептуры. Берём текущую
-- (на момент миграции) рецептуру блюда как лучшее доступное приближение —
-- точного состава на момент добавления в заказ мы не храним. WHERE NOT EXISTS
-- делает запрос безопасным для повторного прогона.
INSERT INTO order_item_modifiers (order_item_id, modifier_id, name, price, warehouse_item_id, qty)
SELECT oi.id, m.id, wi.name, 0, wi.id, mir.qty
FROM order_items oi
JOIN menu_item_recipe mir ON mir.menu_item_id = oi.menu_item_id
JOIN warehouse_items wi ON wi.id = mir.warehouse_item_id
JOIN modifiers m ON m.warehouse_item_id = wi.id AND m.group_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM order_item_modifiers oim WHERE oim.order_item_id = oi.id
);

-- Таблица receipt_item_modifiers создана раньше без modifier_id — CREATE
-- TABLE IF NOT EXISTS выше её не трогает на уже существующей базе, колонку
-- нужно добавить явно.
ALTER TABLE receipt_item_modifiers ADD COLUMN IF NOT EXISTS modifier_id INT REFERENCES modifiers(id) ON DELETE SET NULL;

-- Доливаем ссылку на каталог для уже существующих строк,
-- сопоставляя по названию (снапшот имени должен совпадать с текущим именем
-- модификатора почти всегда, кроме случаев, когда модификатор потом
-- переименовали в каталоге — тогда сравнение состава просто останется
-- недоступным для этой конкретной старой строки, не критично).
UPDATE receipt_item_modifiers rim
SET modifier_id = m.id
FROM modifiers m
WHERE rim.modifier_id IS NULL AND m.name = rim.name;

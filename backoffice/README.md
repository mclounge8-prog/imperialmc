# Imperial MC — бэкофис

Стек: Caddy (TLS/прокси) → Hono на Node.js → PostgreSQL. Фронтенд — htmx + Alpine.js,
без сборщика. Всё разложено по контейнерам через Docker Compose.

Сквозной флоу проверен локально (логин → JWT cookie → dashboard → htmx-фрагменты →
logout) на реальном PostgreSQL. Сама контейнеризация не тестировалась в песочнице —
нет доступа к Docker Hub оттуда, — но конфигурация следует стандартным,
хорошо документированным паттернам Docker Compose.

## Что нужно на сервере

Только Docker + Docker Compose plugin. Node, Postgres и Caddy устанавливать
вручную не нужно — они живут в контейнерах.

```bash
curl -fsSL https://get.docker.com | sh
```

## 1. DNS

A-запись `imperial-mc.online` → IP сервера. Проверить: `dig +short imperial-mc.online`.

## 2. Разместить проект на сервере

Распаковать архив (или `git clone`, если заведёшь репозиторий) в
`/opt/imperial-mc-backoffice`.

## 3. Настроить .env

```bash
cd /opt/imperial-mc-backoffice
cp .env.example .env
```

Отредактировать `.env`:
- `POSTGRES_PASSWORD` — длинный пароль для БД
- `DATABASE_URL` — тот же пароль, хост `postgres` (имя сервиса, не localhost)
- `JWT_SECRET` — `openssl rand -hex 32`

## 4. Поднять всё одной командой

```bash
docker compose up -d --build
```

При первом старте Postgres-контейнер сам выполнит `db/schema.sql` — накатывать
схему вручную не нужно.

## 5. Создать администратора

```bash
docker compose run --rm app node scripts/create-admin.js admin твой-пароль
```

## 6. Проверить

```bash
docker compose ps
docker compose logs -f app
```

Caddy сам получит сертификат Let's Encrypt для `imperial-mc.online` при первом
запросе (нужны открытые порты 80 и 443). Открыть `https://imperial-mc.online/login.html`.

## Обновление после изменений в коде

```bash
docker compose up -d --build app
```

Postgres и Caddy трогать не нужно — пересобирается только контейнер приложения.

## Бэкапы БД

```bash
docker compose exec postgres pg_dump -U imperialmc imperial_mc > backup_$(date +%F).sql
```

Стоит повесить эту команду на cron раз в сутки — это отдельная защита сверх
докеровского volume, на случай проблем с самим сервером.

## Структура

```
Dockerfile               — образ приложения (Node 20 alpine)
docker-compose.yml        — caddy + app + postgres, volumes для данных и сертификатов
.dockerignore
src/
  index.js               — точка входа Hono, статика, защищённый /dashboard
  db.js                   — пул подключений PostgreSQL
  middleware/auth.js       — JWT-проверка (для API и для страниц отдельно)
  routes/auth.js           — POST /api/auth/login, /logout
  routes/dashboard.js      — GET /fragments/:section (htmx-фрагменты)
  views/sections.js         — данные разделов + рендер фрагмента
  views/dashboardShell.js   — HTML-каркас дэшборда с htmx-навигацией
public/
  login.html               — форма входа (htmx, без своего JS)
  css/style.css             — стили
  vendor/                   — htmx.min.js и alpine.min.js, вшиты локально (без CDN)
db/schema.sql               — вся схема БД, накатывается автоматически Postgres-контейнером
deploy/Caddyfile             — конфиг реверс-прокси под imperial-mc.online
scripts/create-admin.js       — CLI создания/обновления администратора
```

## Что дальше

Разделы "Столы / Меню / Склад / Сотрудники" сейчас — пустые состояния-заглушки.
Следующий шаг — завести под каждый раздел свои `/fragments/:section` с реальными
формами (создание/редактирование), которые будут возвращать обновлённый HTML-фрагмент
после сохранения — без единой строчки клиентского JS сверх того, что уже вшито.

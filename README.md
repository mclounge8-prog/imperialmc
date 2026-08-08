# Imperial MC

Монорепозиторий проекта Imperial MC: бэкофис-панель для управления заведением и
мобильное приложение-терминал для персонала.

## Структура

- [`backoffice/`](./backoffice) — веб-панель администратора (Caddy → Hono/Node.js →
  PostgreSQL, фронтенд на htmx + Alpine.js, разворачивается через Docker Compose).
  Подробности — в [`backoffice/README.md`](./backoffice/README.md).
- [`terminal-app/`](./terminal-app) — мобильное приложение-терминал для персонала
  (React Native) для оформления заказов, работы со столами и меню.

## Начало работы

### Бэкофис

```bash
cd backoffice
cp .env.example .env   # заполнить реальными секретами
docker compose up -d --build
```

### Терминал (мобильное приложение)

```bash
cd terminal-app
npm install
npm run android   # или: npm run ios
```

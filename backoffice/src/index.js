import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import authRoutes from './routes/auth.js';
import dashboardRoutes, { renderFragmentHtml } from './routes/dashboard.js';
import staffRoutes from './routes/staff.js';
import warehouseRoutes from './routes/warehouse.js';
import menuRoutes from './routes/menu.js';
import tablesRoutes from './routes/tables.js';
import venuesRoutes from './routes/venues.js';
import devicesRoutes from './routes/devices.js';
import apiStaffAuthRoutes from './routes/apiStaffAuth.js';
import apiTerminalRoutes from './routes/apiTerminal.js';
import apiOrdersRoutes from './routes/apiOrders.js';
import apiDevicesRoutes from './routes/apiDevices.js';
import apiShiftsRoutes from './routes/apiShifts.js';
import reportsRoutes from './routes/reports.js';
import statsRoutes from './routes/stats.js';
import modifiersRoutes from './routes/modifiers.js';
import preferencesRoutes from './routes/preferences.js';
import { requireAuthPage } from './middleware/auth.js';
import { renderDashboardShell } from './views/dashboardShell.js';
import { sections } from './views/sections.js';
import { fetchAllVenues } from './utils/venues.js';
import { readLastSection, readSelectedVenueId, resolveSelectedVenue } from './utils/preferences.js';

const app = new Hono();

app.route('/api/auth', authRoutes);
app.route('/', dashboardRoutes); // отдаёт /fragments/:section (защищено)
app.route('/staff', staffRoutes); // CRUD сотрудников
app.route('/warehouse', warehouseRoutes); // CRUD склада (категории + номенклатура)
app.route('/modifiers', modifiersRoutes); // CRUD каталога модификаторов (группы + сами модификаторы)
app.route('/menu', menuRoutes); // CRUD меню (категории + позиции + рецептура)
app.route('/tables', tablesRoutes); // CRUD столов (зоны + визуальная схема зала)
app.route('/venues', venuesRoutes); // CRUD заведений + назначение сотрудников
app.route('/devices', devicesRoutes); // CRUD устройств: регистрация, заведение, активация
app.route('/api/staff', apiStaffAuthRoutes); // JSON API для Android-терминала: вход по PIN
app.route('/api', apiTerminalRoutes); // JSON API для Android-терминала: /api/tables, /api/menu
app.route('/api', apiOrdersRoutes); // JSON API заказов: открытие/позиции/оплата/закрытие
app.route('/api/devices', apiDevicesRoutes); // JSON API устройств: регистрация по коду, статус
app.route('/api/shifts', apiShiftsRoutes); // JSON API смен: открытие/закрытие, X-отчёт, чеки смены
app.route('/reports', reportsRoutes); // Отчёты: чеки с фильтрами по заведению/датам
app.route('/stats', statsRoutes); // Главный экран: сводная статистика продаж (графики)
app.route('/preferences', preferencesRoutes); // Общий выбор заведения в шапке (cookie)

app.get('/dashboard', requireAuthPage, async (c) => {
  const admin = c.get('admin');
  // Остаёмся в том разделе, где были последний раз — иначе обновление
  // страницы (F5) сбрасывало на «Главную» независимо от текущего хэша в URL
  // (хэш никогда не отправляется на сервер, только cookie может это помнить).
  const lastSection = readLastSection(c);
  const initialKey = lastSection && sections[lastSection] ? lastSection : 'dashboard';

  const venues = await fetchAllVenues();
  const selectedVenue = resolveSelectedVenue(venues, readSelectedVenueId(c));

  const html = renderDashboardShell({
    username: admin.username,
    initialKey,
    initialSectionHtml: await renderFragmentHtml(initialKey, c),
    venues,
    selectedVenueId: selectedVenue ? selectedVenue.id : null,
  });
  return c.html(html);
});

app.get('/', (c) => c.redirect('/login.html'));

// Загруженные изображения — имя файла всегда содержит таймстамп загрузки,
// то есть URL меняется при каждой новой загрузке того же товара. Значит можно
// кешировать агрессивно и надолго: раз URL не поменялся — не поменялось и
// содержимое. Без этого заголовка Image на терминале не может кешировать вообще
// ничего и каждый раз тянет файл заново — именно так по умолчанию себя ведёт
// раздача статики без явных Cache-Control.
app.use('/uploads/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
});

// Статика (login.html, css, вендорные htmx/alpine) — после явных роутов,
// чтобы /dashboard и /fragments/* не перехватывались как файлы
app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT || 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Бэкофис запущен: http://localhost:${info.port}`);
});

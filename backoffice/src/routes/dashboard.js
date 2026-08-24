import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderSection } from '../views/sections.js';
import { renderStaffSection } from '../views/staffView.js';
import { renderWarehouseSection } from '../views/warehouseView.js';
import { renderMenuSection } from '../views/menuView.js';
import { renderTablesSection } from '../views/tablesView.js';
import { withTableDimensions } from '../tableSizes.js';
import { renderVenuesSection } from '../views/venuesView.js';
import { renderDevicesSection } from '../views/devicesView.js';
import { renderUpdatesSection } from '../views/updatesView.js';
import { renderReceiptsSection } from '../views/reportsView.js';
import { fetchReceiptsPage, defaultDateRange, PAGE_SIZE } from './reports.js';
import { renderDashboardFragment } from './stats.js';
import { renderModifiersFragment } from './modifiers.js';
import { fetchAllVenues } from '../utils/venues.js';
import { readSelectedVenueId, resolveSelectedVenue, writeLastSection } from '../utils/preferences.js';
import { pool } from '../db.js';
import { manifestForClient, publicBaseUrl, readManifest } from '../services/terminalUpdates.js';
import { readTelegramSettings } from '../services/telegramNotify.js';
import { renderTelegramSection } from '../views/telegramView.js';

/**
 * Рендер HTML для конкретного раздела дэшборда по ключу.
 * Общая точка входа: используется и роутом /fragments/:section (htmx-переключение
 * вкладок), и начальной загрузкой /dashboard в index.js — чтобы при первом заходе
 * сразу показывались реальные данные, а не статичная заглушка.
 *
 * c (контекст Hono) нужен для чтения cookie с выбранным заведением — склад,
 * меню и столы теперь работают с ОДНИМ общим выбором заведения (шапка), а не
 * каждый со своим, который сбрасывался на первое по списку при каждом
 * переключении раздела.
 */
export async function renderFragmentHtml(key, c) {
  if (key === 'dashboard') {
    return renderDashboardFragment(null);
  }

  if (key === 'venues') {
    const { rows: venueRows } = await pool.query(
      'SELECT id, name, address, COALESCE(precheck_enabled, false) AS precheck_enabled FROM venues ORDER BY name'
    );
    const venueCards = [];
    for (const venue of venueRows) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: assignedRows } = await pool.query(
        `SELECT s.name FROM staff_venues sv
         JOIN staff s ON s.id = sv.staff_id
         WHERE sv.venue_id = $1
         ORDER BY s.name`,
        [venue.id]
      );
      venueCards.push({ venue, assignedNames: assignedRows.map((r) => r.name) });
    }
    return renderVenuesSection(venueCards);
  }

  if (key === 'staff') {
    const { rows } = await pool.query(
      'SELECT id, name, role, is_active FROM staff ORDER BY created_at DESC'
    );
    return renderStaffSection(rows);
  }

  if (key === 'warehouse') {
    const venueRows = await fetchAllVenues();
    const selectedVenue = resolveSelectedVenue(venueRows, readSelectedVenueId(c));
    const { rows: categories } = await pool.query(
      'SELECT id, name FROM warehouse_categories ORDER BY name'
    );
    let items = [];
    if (selectedVenue) {
      const { rows } = await pool.query(
        `SELECT wi.id, wi.name, wi.category_id, wi.unit, wc.name AS category_name,
                COALESCE(vws.stock_qty, 0) AS stock_qty,
                COALESCE(vws.min_stock_qty, 0) AS min_stock_qty
         FROM warehouse_items wi
         LEFT JOIN warehouse_categories wc ON wc.id = wi.category_id
         LEFT JOIN venue_warehouse_stock vws
           ON vws.warehouse_item_id = wi.id AND vws.venue_id = $1
         WHERE vws.venue_id IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM modifiers m
              JOIN menu_item_modifiers mim ON mim.modifier_id = m.id
              JOIN menu_items mi ON mi.id = mim.menu_item_id
              LEFT JOIN menu_categories mc ON mc.id = mi.category_id
              WHERE m.warehouse_item_id = wi.id
                AND (
                  mc.id IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM venue_hidden_menu_categories h
                    WHERE h.venue_id = $1 AND h.category_id = mc.id
                  )
                )
                AND (
                  mc.parent_id IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM venue_hidden_menu_categories h
                    WHERE h.venue_id = $1 AND h.category_id = mc.parent_id
                  )
                )
            )
         ORDER BY wi.name`,
        [selectedVenue.id]
      );
      items = rows;
    }
    return renderWarehouseSection(venueRows, selectedVenue ? selectedVenue.id : null, categories, items);
  }

  if (key === 'modifiers') {
    return renderModifiersFragment();
  }

  if (key === 'menu') {
    const venueRows = await fetchAllVenues();
    const selectedVenue = resolveSelectedVenue(venueRows, readSelectedVenueId(c));
    const { rows: categories } = await pool.query(
      'SELECT id, name, icon, parent_id, sort_order FROM menu_categories ORDER BY sort_order, name'
    );
    const { rows: items } = await pool.query(
      `SELECT mi.id, mi.name, mi.category_id, mi.price, mi.image_url, mi.is_active,
              (SELECT COUNT(*) FROM menu_item_recipe WHERE menu_item_id = mi.id) AS recipe_count
       FROM menu_items mi
       ORDER BY mi.created_at DESC`
    );
    let hiddenCategoryIds = [];
    if (selectedVenue) {
      const { rows: hiddenRows } = await pool.query(
        'SELECT category_id FROM venue_hidden_menu_categories WHERE venue_id = $1',
        [selectedVenue.id]
      );
      hiddenCategoryIds = hiddenRows.map((r) => r.category_id);
    }
    return renderMenuSection(
      venueRows,
      selectedVenue ? selectedVenue.id : null,
      categories,
      hiddenCategoryIds,
      items
    );
  }

  if (key === 'tables') {
    const venueRows = await fetchAllVenues();
    const selectedVenue = resolveSelectedVenue(venueRows, readSelectedVenueId(c));
    let zones = [];
    let selectedZone = null;
    let tableRows = [];
    if (selectedVenue) {
      const { rows } = await pool.query(
        'SELECT id, name, sort_order FROM zones WHERE venue_id = $1 ORDER BY sort_order ASC, id ASC',
        [selectedVenue.id]
      );
      zones = rows;
      selectedZone = zones[0] || null;
      if (selectedZone) {
        const { rows: tRows } = await pool.query(
          'SELECT id, zone_id, name, capacity, pos_x, pos_y, width, height, size, status FROM tables WHERE zone_id = $1 ORDER BY id',
          [selectedZone.id]
        );
        tableRows = tRows.map(withTableDimensions);
      }
    }
    return renderTablesSection(
      venueRows,
      selectedVenue ? selectedVenue.id : null,
      zones,
      selectedZone,
      tableRows
    );
  }

  if (key === 'devices') {
    const { rows: deviceRows } = await pool.query(
      'SELECT id, name, venue_id, is_active, last_seen_at FROM devices ORDER BY registered_at DESC'
    );
    const { rows: venueRows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
    return renderDevicesSection(deviceRows, venueRows);
  }

  if (key === 'updates') {
    const manifest = await readManifest();
    return renderUpdatesSection(manifest, manifestForClient(manifest, publicBaseUrl(c)));
  }

  if (key === 'telegram') {
    const settings = await readTelegramSettings();
    return renderTelegramSection(settings);
  }

  if (key === 'reports') {
    const { rows: venues } = await pool.query('SELECT id, name FROM venues ORDER BY name');
    const { from, to } = defaultDateRange();
    const { rows: receipts, totalCount } = await fetchReceiptsPage({
      venueId: null,
      dateFrom: from,
      dateTo: to,
      page: 1,
    });
    return renderReceiptsSection(venues, null, from, to, receipts, {
      page: 1,
      totalCount,
      pageSize: PAGE_SIZE,
    });
  }

  return renderSection(key);
}

const dashboard = new Hono();

dashboard.get('/fragments/:section', requireAuthApi, async (c) => {
  const key = c.req.param('section');
  const html = await renderFragmentHtml(key, c);

  if (!html) {
    c.status(404);
    return c.text('Раздел не найден');
  }

  // Запоминаем, где именно был админ — используется при полной перезагрузке
  // страницы (F5), чтобы оставаться на месте, а не сбрасываться на «Главную».
  writeLastSection(c, key);

  return c.html(html);
});

export default dashboard;

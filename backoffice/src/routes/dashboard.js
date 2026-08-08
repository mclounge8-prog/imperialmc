import { Hono } from 'hono';
import { requireAuthApi } from '../middleware/auth.js';
import { renderSection } from '../views/sections.js';
import { renderStaffSection } from '../views/staffView.js';
import { renderWarehouseSection } from '../views/warehouseView.js';
import { renderMenuSection } from '../views/menuView.js';
import { renderTablesSection } from '../views/tablesView.js';
import { renderVenuesSection } from '../views/venuesView.js';
import { renderDevicesSection } from '../views/devicesView.js';
import { renderReceiptsSection } from '../views/reportsView.js';
import { fetchReceiptsPage, defaultDateRange, PAGE_SIZE } from './reports.js';
import { renderDashboardFragment } from './stats.js';
import { pool } from '../db.js';

/**
 * Рендер HTML для конкретного раздела дэшборда по ключу.
 * Общая точка входа: используется и роутом /fragments/:section (htmx-переключение
 * вкладок), и начальной загрузкой /dashboard в index.js — чтобы при первом заходе
 * сразу показывались реальные данные, а не статичная заглушка.
 */
export async function renderFragmentHtml(key) {
  if (key === 'dashboard') {
    return renderDashboardFragment(null);
  }

  if (key === 'venues') {
    const { rows: venueRows } = await pool.query(
      'SELECT id, name, address FROM venues ORDER BY name'
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
    const { rows: venueRows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
    const selectedVenue = venueRows[0] || null;
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
         LEFT JOIN venue_warehouse_stock vws ON vws.warehouse_item_id = wi.id AND vws.venue_id = $1
         ORDER BY wi.name`,
        [selectedVenue.id]
      );
      items = rows;
    }
    return renderWarehouseSection(venueRows, selectedVenue ? selectedVenue.id : null, categories, items);
  }

  if (key === 'menu') {
    const { rows: venueRows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
    const selectedVenue = venueRows[0] || null;
    const { rows: categories } = await pool.query(
      'SELECT id, name, icon FROM menu_categories ORDER BY sort_order, name'
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
    const { rows: venueRows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
    const selectedVenue = venueRows[0] || null;
    let zones = [];
    let selectedZone = null;
    let tableRows = [];
    if (selectedVenue) {
      const { rows } = await pool.query('SELECT id, name FROM zones WHERE venue_id = $1 ORDER BY name', [
        selectedVenue.id,
      ]);
      zones = rows;
      selectedZone = zones[0] || null;
      if (selectedZone) {
        const { rows: tRows } = await pool.query(
          'SELECT id, zone_id, name, capacity, pos_x, pos_y, status FROM tables WHERE zone_id = $1 ORDER BY id',
          [selectedZone.id]
        );
        tableRows = tRows;
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
  const html = await renderFragmentHtml(key);

  if (!html) {
    c.status(404);
    return c.text('Раздел не найден');
  }

  return c.html(html);
});

export default dashboard;

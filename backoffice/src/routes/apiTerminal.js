import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import { withTableDimensions } from '../tableSizes.js';
import { fetchVenueMenu } from '../services/venueMenu.js';

const apiTerminal = new Hono();
// Заведения, назначенные вошедшему сотруднику — терминал спрашивает,
// с каким работаем, если их несколько (или выбирает единственное сам)
apiTerminal.get('/venues', requireStaffToken, async (c) => {
  const staff = c.get('staff');
  const { rows } = await pool.query(
    `SELECT v.id, v.name FROM staff_venues sv
     JOIN venues v ON v.id = sv.venue_id
     WHERE sv.staff_id = $1
     ORDER BY v.name`,
    [staff.sub]
  );
  return c.json({ venues: rows });
});

apiTerminal.get('/tables', requireStaffToken, async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows: zones } = await pool.query(
    'SELECT id, name FROM zones WHERE venue_id = $1 ORDER BY sort_order ASC, id ASC',
    [venueId]
  );
  const { rows: tableRows } = await pool.query(
    `SELECT t.id, t.zone_id, t.name, t.capacity, t.status, t.pos_x, t.pos_y, t.width, t.height, t.size
     FROM tables t
     JOIN zones z ON z.id = t.zone_id
     WHERE z.venue_id = $1
     ORDER BY t.id`,
    [venueId]
  );

  const zonesWithTables = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    tables: tableRows
      .filter((t) => t.zone_id === zone.id)
      .map((t) => {
        const normalized = withTableDimensions(t);
        return {
          id: normalized.id,
          name: normalized.name,
          capacity: normalized.capacity,
          status: normalized.status,
          posX: normalized.pos_x,
          posY: normalized.pos_y,
          size: normalized.size,
          width: normalized.width,
          height: normalized.height,
        };
      }),
  }));

  return c.json({ zones: zonesWithTables });
});

apiTerminal.get('/menu', requireStaffToken, async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const menu = await fetchVenueMenu(venueId);
  return c.json(menu);
});

export default apiTerminal;

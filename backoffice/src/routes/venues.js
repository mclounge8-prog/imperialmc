import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderVenueCard,
  renderVenueEditCard,
  renderVenueStaffPanel,
  renderVenueListOob,
} from '../views/venuesView.js';

const venues = new Hono();
venues.use('*', requireAuthApi);

async function fetchVenue(id) {
  const { rows } = await pool.query('SELECT id, name, address FROM venues WHERE id = $1', [id]);
  return rows[0] || null;
}

async function fetchAssignedStaffNames(venueId) {
  const { rows } = await pool.query(
    `SELECT s.name FROM staff_venues sv
     JOIN staff s ON s.id = sv.staff_id
     WHERE sv.venue_id = $1
     ORDER BY s.name`,
    [venueId]
  );
  return rows.map((r) => r.name);
}

async function fetchAllVenueCards() {
  const { rows: venueRows } = await pool.query('SELECT id, name, address FROM venues ORDER BY name');
  const cards = [];
  for (const venue of venueRows) {
    // eslint-disable-next-line no-await-in-loop
    const assignedNames = await fetchAssignedStaffNames(venue.id);
    cards.push({ venue, assignedNames });
  }
  return cards;
}

venues.post('/', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const address = String(body.address || '').trim();

  if (!name) return c.html('<p>Укажи название заведения</p>');

  await pool.query('INSERT INTO venues (name, address) VALUES ($1, $2)', [name, address || null]);

  const cards = await fetchAllVenueCards();
  return c.html(renderVenueListOob(cards));
});

venues.get('/:id/edit', async (c) => {
  const venue = await fetchVenue(c.req.param('id'));
  if (!venue) {
    c.status(404);
    return c.text('Заведение не найдено');
  }
  return c.html(renderVenueEditCard(venue));
});

venues.get('/:id/view', async (c) => {
  const venue = await fetchVenue(c.req.param('id'));
  if (!venue) {
    c.status(404);
    return c.text('Заведение не найдено');
  }
  const assignedNames = await fetchAssignedStaffNames(venue.id);
  return c.html(renderVenueCard(venue, assignedNames));
});

venues.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const address = String(body.address || '').trim();

  const current = await fetchVenue(id);
  if (!current) {
    c.status(404);
    return c.text('Заведение не найдено');
  }

  if (!name) {
    return c.html(renderVenueEditCard({ ...current }, 'Укажи название'));
  }

  await pool.query('UPDATE venues SET name = $1, address = $2 WHERE id = $3', [
    name,
    address || null,
    id,
  ]);

  const updated = await fetchVenue(id);
  const assignedNames = await fetchAssignedStaffNames(id);
  return c.html(renderVenueCard(updated, assignedNames));
});

venues.delete('/:id', async (c) => {
  await pool.query('DELETE FROM venues WHERE id = $1', [c.req.param('id')]);
  return c.body(null);
});

venues.get('/:id/staff', async (c) => {
  const venueId = c.req.param('id');
  const venue = await fetchVenue(venueId);
  if (!venue) {
    c.status(404);
    return c.text('Заведение не найдено');
  }

  const { rows: staffList } = await pool.query(
    'SELECT id, name FROM staff WHERE is_active = true ORDER BY name'
  );
  const { rows: assignedRows } = await pool.query(
    'SELECT staff_id FROM staff_venues WHERE venue_id = $1',
    [venueId]
  );
  const assignedStaffIds = assignedRows.map((r) => r.staff_id);

  return c.html(renderVenueStaffPanel(venue, staffList, assignedStaffIds));
});

venues.post('/:venueId/staff/:staffId/toggle', async (c) => {
  const { venueId, staffId } = c.req.param();

  const { rows: existing } = await pool.query(
    'SELECT 1 FROM staff_venues WHERE venue_id = $1 AND staff_id = $2',
    [venueId, staffId]
  );

  if (existing[0]) {
    await pool.query('DELETE FROM staff_venues WHERE venue_id = $1 AND staff_id = $2', [
      venueId,
      staffId,
    ]);
  } else {
    await pool.query('INSERT INTO staff_venues (venue_id, staff_id) VALUES ($1, $2)', [
      venueId,
      staffId,
    ]);
  }

  const venue = await fetchVenue(venueId);
  const { rows: staffList } = await pool.query(
    'SELECT id, name FROM staff WHERE is_active = true ORDER BY name'
  );
  const { rows: assignedRows } = await pool.query(
    'SELECT staff_id FROM staff_venues WHERE venue_id = $1',
    [venueId]
  );
  const assignedStaffIds = assignedRows.map((r) => r.staff_id);

  return c.html(
    renderVenueStaffPanel(venue, staffList, assignedStaffIds, { withSummaryOob: true })
  );
});

export default venues;

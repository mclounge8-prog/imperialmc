import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireAuthApi } from '../middleware/auth.js';
import {
  renderVenueCard,
  renderVenueEditCard,
  renderVenueStaffPanel,
  renderVenueListOob,
  renderVenueAtolPanel,
  renderVenueAtolJobsRows,
} from '../views/venuesView.js';

const venues = new Hono();
venues.use('*', requireAuthApi);

async function fetchVenue(id) {
  const { rows } = await pool.query(
    'SELECT id, name, address, COALESCE(precheck_enabled, false) AS precheck_enabled FROM venues WHERE id = $1',
    [id]
  );
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
  const { rows: venueRows } = await pool.query(
    'SELECT id, name, address, COALESCE(precheck_enabled, false) AS precheck_enabled FROM venues ORDER BY name'
  );
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

venues.post('/:id/precheck-toggle', async (c) => {
  const id = c.req.param('id');
  const current = await fetchVenue(id);
  if (!current) {
    c.status(404);
    return c.text('Заведение не найдено');
  }

  await pool.query(
    'UPDATE venues SET precheck_enabled = NOT COALESCE(precheck_enabled, false) WHERE id = $1',
    [id]
  );

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

async function fetchAtolSettings(venueId) {
  const { rows } = await pool.query('SELECT * FROM venue_atol_settings WHERE venue_id = $1', [venueId]);
  return rows[0] || null;
}

async function fetchRecentFiscalJobs(venueId, limit = 30) {
  // Только за последние сутки — полный архив не нужен, TTL чистит старое.
  const { rows } = await pool.query(
    `SELECT * FROM fiscal_jobs
     WHERE venue_id = $1 AND created_at >= now() - interval '1 day'
     ORDER BY id DESC
     LIMIT $2`,
    [venueId, limit]
  );
  return rows;
}

venues.get('/:id/atol', async (c) => {
  const venueId = c.req.param('id');
  const venue = await fetchVenue(venueId);
  if (!venue) {
    c.status(404);
    return c.text('Заведение не найдено');
  }

  const settings = await fetchAtolSettings(venueId);
  const jobs = await fetchRecentFiscalJobs(venueId);
  return c.html(renderVenueAtolPanel(venue, settings, jobs));
});

venues.post('/:id/atol', async (c) => {
  const venueId = c.req.param('id');
  const venue = await fetchVenue(venueId);
  if (!venue) {
    c.status(404);
    return c.text('Заведение не найдено');
  }

  const body = await c.req.parseBody();
  const enabled = body.enabled === 'on' || body.enabled === 'true';
  const kktIp = String(body.kkt_ip || '').trim() || null;
  const kktPort = body.kkt_port ? Number(body.kkt_port) : 5555;
  const kktModel = body.kkt_model ? Number(body.kkt_model) : null;
  const operatorName = String(body.operator_name || '').trim() || null;

  await pool.query(
    `INSERT INTO venue_atol_settings (venue_id, enabled, kkt_ip, kkt_port, kkt_model, operator_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (venue_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       kkt_ip = EXCLUDED.kkt_ip,
       kkt_port = EXCLUDED.kkt_port,
       kkt_model = EXCLUDED.kkt_model,
       operator_name = EXCLUDED.operator_name,
       updated_at = now()`,
    [venueId, enabled, kktIp, kktPort, kktModel, operatorName]
  );

  const settings = await fetchAtolSettings(venueId);
  const jobs = await fetchRecentFiscalJobs(venueId);
  return c.html(renderVenueAtolPanel(venue, settings, jobs));
});

venues.get('/:id/atol/jobs', async (c) => {
  const venueId = c.req.param('id');
  const jobs = await fetchRecentFiscalJobs(venueId);
  return c.html(renderVenueAtolJobsRows(jobs, venueId));
});

// Вернуть упавшее задание в очередь (например, кассу временно отключали от сети) —
// terminal-app подхватит его при следующем опросе.
venues.post('/:id/atol/jobs/:jobId/retry', async (c) => {
  const { id: venueId, jobId } = c.req.param();
  await pool.query(
    "UPDATE fiscal_jobs SET status = 'pending', last_error = NULL, updated_at = now() WHERE id = $1 AND venue_id = $2 AND status IN ('error', 'in_progress')",
    [jobId, venueId]
  );

  const jobs = await fetchRecentFiscalJobs(venueId);
  return c.html(renderVenueAtolJobsRows(jobs, venueId));
});

venues.delete('/:id/atol/jobs/:jobId', async (c) => {
  const { id: venueId, jobId } = c.req.param();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, type, receipt_id, status FROM fiscal_jobs
       WHERE id = $1 AND venue_id = $2 FOR UPDATE`,
      [jobId, venueId]
    );
    const job = rows[0];
    if (job && (job.status === 'error' || job.status === 'in_progress')) {
      await client.query('DELETE FROM fiscal_jobs WHERE id = $1', [jobId]);
      if (job.type === 'receipt' && job.receipt_id) {
        await client.query(
          `UPDATE receipts SET fiscal_status = NULL WHERE id = $1 AND fiscal_status = 'error'`,
          [job.receipt_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const jobs = await fetchRecentFiscalJobs(venueId);
  return c.html(renderVenueAtolJobsRows(jobs, venueId));
});

export default venues;

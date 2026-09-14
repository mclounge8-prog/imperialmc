import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import {
  fetchShiftTobaccoCount,
  fetchVenueTobaccoSettings,
  fetchVenueTobaccoTares,
  saveShiftTobaccoCount,
  serializeTobaccoCountForTerminal,
} from '../services/tobaccoAccounting.js';

const apiTobacco = new Hono();
apiTobacco.use('*', requireStaffToken);

async function fetchOpenShift(venueId) {
  const { rows } = await pool.query(
    "SELECT * FROM shifts WHERE venue_id = $1 AND status = 'open'",
    [venueId]
  );
  return rows[0] || null;
}

function parseVenueId(c) {
  const q = c.req.query('venueId') || c.req.query('venue_id');
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Состояние учёта для терминала: настройки + тары (без expected) + факт по смене. */
apiTobacco.get('/state', async (c) => {
  const venueId = parseVenueId(c);
  if (!venueId) return c.json({ error: 'Не указано заведение' }, 400);

  const venue = await fetchVenueTobaccoSettings(venueId);
  if (!venue) return c.json({ error: 'Заведение не найдено' }, 404);

  const enabled = !!venue.tobacco_accounting_enabled;
  if (!enabled) {
    return c.json({
      enabled: false,
      toleranceG: Number(venue.tobacco_tolerance_g),
      tares: [],
      count: null,
      shiftId: null,
    });
  }

  const shift = await fetchOpenShift(venueId);
  const taresRaw = await fetchVenueTobaccoTares(venueId);
  const count = shift ? await fetchShiftTobaccoCount(shift.id) : null;

  return c.json({
    enabled: true,
    toleranceG: Number(venue.tobacco_tolerance_g),
    shiftId: shift ? shift.id : null,
    tares: taresRaw.map((t) => ({
      id: t.id,
      brand: t.brand,
      label: t.label,
      netContentG: t.netContentG,
      tareWeightG: t.tareWeightG,
      qty: t.qty,
      // expectedStockG намеренно не отдаём на терминал
    })),
    count: serializeTobaccoCountForTerminal(count),
  });
});

/** Изменить кол-во банок тары: delta (+/-) или абсолютный qty. */
apiTobacco.post('/tare-qty', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body?.venue_id != null ? Number(body.venue_id) : Number(body?.venueId);
  const tareId = body?.tobacco_tare_id != null ? Number(body.tobacco_tare_id) : Number(body?.tobaccoTareId);
  if (!venueId || !tareId) return c.json({ error: 'Нужны venue_id и tobacco_tare_id' }, 400);

  const venue = await fetchVenueTobaccoSettings(venueId);
  if (!venue?.tobacco_accounting_enabled) {
    return c.json({ error: 'Учёт табака выключен на заведении' }, 409);
  }

  let nextQty;
  if (body?.qty != null) {
    nextQty = Math.max(0, Math.round(Number(body.qty) || 0));
  } else {
    const delta = Math.round(Number(body?.delta ?? 0) || 0);
    const { rows } = await pool.query(
      `SELECT COALESCE(qty, 0)::int AS qty FROM venue_tobacco_tare_stock
       WHERE venue_id = $1 AND tobacco_tare_id = $2`,
      [venueId, tareId]
    );
    nextQty = Math.max(0, Number(rows[0]?.qty || 0) + delta);
  }

  await pool.query(
    `INSERT INTO venue_tobacco_tare_stock (venue_id, tobacco_tare_id, qty, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (venue_id, tobacco_tare_id)
     DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()`,
    [venueId, tareId, nextQty]
  );

  // staff unused but available for future audit
  void staff;

  const taresRaw = await fetchVenueTobaccoTares(venueId);
  return c.json({
    qty: nextQty,
    tares: taresRaw.map((t) => ({
      id: t.id,
      brand: t.brand,
      label: t.label,
      netContentG: t.netContentG,
      tareWeightG: t.tareWeightG,
      qty: t.qty,
    })),
  });
});

/** Сохранить подсчёт по открытой смене. */
apiTobacco.post('/count', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body?.venue_id != null ? Number(body.venue_id) : Number(body?.venueId);
  if (!venueId) return c.json({ error: 'Не указано заведение' }, 400);

  const venue = await fetchVenueTobaccoSettings(venueId);
  if (!venue?.tobacco_accounting_enabled) {
    return c.json({ error: 'Учёт табака выключен на заведении' }, 409);
  }

  const shift = await fetchOpenShift(venueId);
  if (!shift) return c.json({ error: 'Нет открытой смены', code: 'SHIFT_REQUIRED' }, 409);

  const count = await saveShiftTobaccoCount({
    shiftId: shift.id,
    venueId,
    staffId: staff.sub,
    staffName: staff.name,
    lines: body?.lines || [],
    toleranceG: Number(venue.tobacco_tolerance_g),
  });

  return c.json({
    count: serializeTobaccoCountForTerminal(count),
    // Для кассира: только факт чистого веса и флаг «в допуске» без цифр склада.
    summary: {
      totalNetG: count.totalNetG,
      withinTolerance: count.withinTolerance,
      toleranceG: Number(venue.tobacco_tolerance_g),
    },
  });
});

export default apiTobacco;

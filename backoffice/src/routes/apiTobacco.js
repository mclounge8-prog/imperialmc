import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';
import {
  fetchShiftTobaccoCount,
  fetchVenueTobaccoSettings,
  fetchVenueTobaccoTares,
  saveShiftTobaccoCount,
  saveTobaccoTareMovement,
  serializeTobaccoCountForTerminal,
} from '../services/tobaccoAccounting.js';
import {
  buildTobaccoTareMovementMessage,
  fetchVenueName,
  notifyTelegramSafe,
} from '../services/telegramNotify.js';

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

/**
 * Приход / списание тары несколькими позициями (поставки приходят пачками).
 * body: { venue_id, type: 'receipt'|'writeoff', lines: [{ tobaccoTareId, qty }], comment? }
 */
apiTobacco.post('/tare-movements', async (c) => {
  const staff = c.get('staff');
  const body = await c.req.json().catch(() => null);
  const venueId = body?.venue_id != null ? Number(body.venue_id) : Number(body?.venueId);
  const type = body?.type === 'writeoff' || body?.type === 'receipt' ? body.type : null;
  if (!venueId || !type) {
    return c.json({ error: 'Нужны venue_id и type (receipt|writeoff)' }, 400);
  }

  const venue = await fetchVenueTobaccoSettings(venueId);
  if (!venue?.tobacco_accounting_enabled) {
    return c.json({ error: 'Учёт табака выключен на заведении' }, 409);
  }

  const shift = await fetchOpenShift(venueId);

  try {
    const result = await saveTobaccoTareMovement({
      venueId,
      shiftId: shift?.id || null,
      type,
      staffId: staff.sub,
      staffName: staff.name,
      lines: body?.lines || [],
      comment: body?.comment,
    });

    const venueName = venue.name || (await fetchVenueName(venueId));
    notifyTelegramSafe(
      buildTobaccoTareMovementMessage({
        venueName,
        type,
        lines: result.movement?.lines || [],
        comment: result.movement?.comment,
        cashier: staff.name,
        when: result.movement?.createdAt,
      })
    );

    return c.json(result);
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 400 && status < 500) {
      return c.json({ error: err.message || 'Ошибка операции с тарой' }, status);
    }
    throw err;
  }
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

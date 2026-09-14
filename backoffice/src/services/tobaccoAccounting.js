import { pool } from '../db.js';

export function roundGrams(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export async function fetchVenueTobaccoSettings(venueId) {
  const { rows } = await pool.query(
    `SELECT id, name,
            COALESCE(tobacco_accounting_enabled, false) AS tobacco_accounting_enabled,
            COALESCE(tobacco_tolerance_g, 100) AS tobacco_tolerance_g
     FROM venues WHERE id = $1`,
    [venueId]
  );
  return rows[0] || null;
}

/** Тары, задействованные на заведении (через выбранную номенклатуру) + текущее кол-во банок. */
export async function fetchVenueTobaccoTares(venueId) {
  const { rows } = await pool.query(
    `SELECT
       t.id,
       t.brand,
       t.label,
       t.net_content_g,
       t.tare_weight_g,
       t.is_active,
       COALESCE(s.qty, 0)::int AS qty,
       COALESCE((
         SELECT SUM(COALESCE(vws.stock_qty, 0))
         FROM venue_tobacco_items vti
         LEFT JOIN venue_warehouse_stock vws
           ON vws.venue_id = vti.venue_id AND vws.warehouse_item_id = vti.warehouse_item_id
         WHERE vti.venue_id = $1 AND vti.tobacco_tare_id = t.id
       ), 0) AS expected_stock_g,
       (
         SELECT COUNT(*)::int FROM venue_tobacco_items vti
         WHERE vti.venue_id = $1 AND vti.tobacco_tare_id = t.id
       ) AS item_count
     FROM tobacco_tares t
     LEFT JOIN venue_tobacco_tare_stock s
       ON s.venue_id = $1 AND s.tobacco_tare_id = t.id
     WHERE t.is_active = true
       AND EXISTS (
         SELECT 1 FROM venue_tobacco_items vti
         WHERE vti.venue_id = $1 AND vti.tobacco_tare_id = t.id
       )
     ORDER BY t.brand, t.label`,
    [venueId]
  );
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    label: r.label,
    netContentG: r.net_content_g != null ? Number(r.net_content_g) : null,
    tareWeightG: Number(r.tare_weight_g),
    qty: Number(r.qty),
    expectedStockG: Number(r.expected_stock_g),
    itemCount: Number(r.item_count),
  }));
}

export async function fetchShiftTobaccoCount(shiftId) {
  const { rows } = await pool.query(
    `SELECT c.*, 
            COALESCE(json_agg(
              json_build_object(
                'id', l.id,
                'tobaccoTareId', l.tobacco_tare_id,
                'tareLabel', l.tare_label,
                'brand', l.brand,
                'tareWeightG', l.tare_weight_g,
                'canQty', l.can_qty,
                'grossWeightParts', l.gross_weight_parts,
                'grossWeightG', l.gross_weight_g,
                'netWeightG', l.net_weight_g,
                'expectedStockG', l.expected_stock_g,
                'deltaG', l.delta_g
              ) ORDER BY l.id
            ) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines
     FROM shift_tobacco_counts c
     LEFT JOIN shift_tobacco_count_lines l ON l.count_id = c.id
     WHERE c.shift_id = $1
     GROUP BY c.id`,
    [shiftId]
  );
  if (!rows[0]) return null;
  const c = rows[0];
  return {
    id: c.id,
    shiftId: c.shift_id,
    venueId: c.venue_id,
    countedAt: c.counted_at,
    countedByName: c.counted_by_name,
    totalNetG: Number(c.total_net_g),
    totalExpectedG: Number(c.total_expected_g),
    withinTolerance: !!c.within_tolerance,
    skipped: !!c.skipped,
    lines: Array.isArray(c.lines) ? c.lines : [],
  };
}

/**
 * Сохранить подсчёт по открытой смене.
 * lines: [{ tobaccoTareId, canQty, grossWeightParts: number[] }]
 * Не возвращает expected клиенту наружу — caller решает, что отдавать.
 */
export async function saveShiftTobaccoCount({
  shiftId,
  venueId,
  staffId,
  staffName,
  lines,
  toleranceG,
}) {
  const tares = await fetchVenueTobaccoTares(venueId);
  const byId = new Map(tares.map((t) => [t.id, t]));

  const normalized = [];
  for (const raw of lines || []) {
    const tareId = Number(raw.tobaccoTareId ?? raw.tobacco_tare_id);
    const tare = byId.get(tareId);
    if (!tare) continue;
    const canQty = Math.max(0, Math.round(Number(raw.canQty ?? raw.can_qty ?? tare.qty) || 0));
    const parts = Array.isArray(raw.grossWeightParts || raw.gross_weight_parts)
      ? (raw.grossWeightParts || raw.gross_weight_parts)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v >= 0)
      : [];
    const gross = roundGrams(parts.reduce((s, v) => s + v, 0));
    const net = roundGrams(gross - tare.tareWeightG * canQty);
    const expected = roundGrams(tare.expectedStockG);
    const delta = roundGrams(net - expected);
    normalized.push({
      tobaccoTareId: tare.id,
      tareLabel: tare.label,
      brand: tare.brand,
      tareWeightG: tare.tareWeightG,
      canQty,
      grossWeightParts: parts,
      grossWeightG: gross,
      netWeightG: net,
      expectedStockG: expected,
      deltaG: delta,
    });
  }

  const totalNet = roundGrams(normalized.reduce((s, l) => s + l.netWeightG, 0));
  const totalExpected = roundGrams(normalized.reduce((s, l) => s + l.expectedStockG, 0));
  const tol = Number(toleranceG);
  const within = Math.abs(totalNet - totalExpected) <= (Number.isFinite(tol) ? tol : 100);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM shift_tobacco_counts WHERE shift_id = $1', [shiftId]);
    const { rows } = await client.query(
      `INSERT INTO shift_tobacco_counts
         (shift_id, venue_id, counted_by, counted_by_name, total_net_g, total_expected_g, within_tolerance, skipped)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING id`,
      [shiftId, venueId, staffId, staffName, totalNet, totalExpected, within]
    );
    const countId = rows[0].id;
    for (const line of normalized) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO shift_tobacco_count_lines
           (count_id, tobacco_tare_id, tare_label, brand, tare_weight_g, can_qty,
            gross_weight_parts, gross_weight_g, net_weight_g, expected_stock_g, delta_g)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
        [
          countId,
          line.tobaccoTareId,
          line.tareLabel,
          line.brand,
          line.tareWeightG,
          line.canQty,
          JSON.stringify(line.grossWeightParts),
          line.grossWeightG,
          line.netWeightG,
          line.expectedStockG,
          line.deltaG,
        ]
      );
    }
    await client.query('COMMIT');
    return fetchShiftTobaccoCount(shiftId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Пометить, что учёт пропущен при закрытии (для истории / Telegram). */
export async function markTobaccoCountSkipped({ shiftId, venueId, staffId, staffName }) {
  await pool.query('DELETE FROM shift_tobacco_counts WHERE shift_id = $1', [shiftId]);
  await pool.query(
    `INSERT INTO shift_tobacco_counts
       (shift_id, venue_id, counted_by, counted_by_name, total_net_g, total_expected_g, within_tolerance, skipped)
     VALUES ($1, $2, $3, $4, 0, 0, false, true)`,
    [shiftId, venueId, staffId, staffName]
  );
}

export function serializeTobaccoCountForTerminal(count) {
  if (!count) return null;
  return {
    id: count.id,
    shiftId: count.shiftId,
    countedAt: count.countedAt,
    countedByName: count.countedByName,
    totalNetG: count.totalNetG,
    withinTolerance: count.withinTolerance,
    skipped: count.skipped,
    // Намеренно без expected / delta — терминал не должен светить остатки.
    lines: (count.lines || []).map((l) => ({
      tobaccoTareId: l.tobaccoTareId,
      tareLabel: l.tareLabel,
      brand: l.brand,
      tareWeightG: Number(l.tareWeightG),
      canQty: Number(l.canQty),
      grossWeightParts: l.grossWeightParts || [],
      grossWeightG: Number(l.grossWeightG),
      netWeightG: Number(l.netWeightG),
    })),
  };
}

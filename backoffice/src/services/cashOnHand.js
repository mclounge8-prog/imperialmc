import { pool } from '../db.js';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Сейчас в кассе по открытым сменам:
 * opening_cash + cash sales (paid) + deposits − withdrawals.
 * Заведения без открытой смены — 0 (hasOpenShift: false).
 *
 * @param {string|null} venueId фильтр по одному заведению (или null = все)
 * @returns {{ total: number, venues: Array<{venueId, venueName, expectedCash, hasOpenShift, shiftId}> }}
 */
export async function fetchCashOnHand(venueId = null) {
  const params = [];
  const venueFilter = venueId ? (params.push(venueId), `WHERE v.id = $1`) : '';

  const { rows } = await pool.query(
    `SELECT
       v.id AS venue_id,
       v.name AS venue_name,
       s.id AS shift_id,
       COALESCE(s.opening_cash, 0) AS opening_cash,
       COALESCE((
         SELECT SUM(rp.amount)
         FROM receipt_payments rp
         JOIN receipts r ON r.id = rp.receipt_id
         WHERE r.shift_id = s.id AND r.status = 'paid' AND rp.method = 'cash'
       ), 0) AS cash_sales,
       COALESCE((
         SELECT SUM(amount) FROM cash_movements
         WHERE shift_id = s.id AND type = 'deposit'
       ), 0) AS deposits,
       COALESCE((
         SELECT SUM(amount) FROM cash_movements
         WHERE shift_id = s.id AND type = 'withdrawal'
       ), 0) AS withdrawals
     FROM venues v
     LEFT JOIN shifts s ON s.venue_id = v.id AND s.status = 'open'
     ${venueFilter}
     ORDER BY v.name`,
    params
  );

  const venues = rows.map((row) => {
    const hasOpenShift = Boolean(row.shift_id);
    const expectedCash = hasOpenShift
      ? roundMoney(
          Number(row.opening_cash) +
            Number(row.cash_sales) +
            Number(row.deposits) -
            Number(row.withdrawals)
        )
      : 0;
    return {
      venueId: row.venue_id,
      venueName: row.venue_name,
      expectedCash,
      hasOpenShift,
      shiftId: row.shift_id || null,
    };
  });

  const total = roundMoney(venues.reduce((sum, v) => sum + v.expectedCash, 0));
  return { total, venues };
}

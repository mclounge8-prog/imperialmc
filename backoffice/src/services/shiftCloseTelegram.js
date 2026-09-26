import { pool } from '../db.js';
import {
  fetchShiftTobaccoCount,
  fetchVenueTobaccoSettings,
} from './tobaccoAccounting.js';
import {
  buildShiftCloseMessage,
  buildTobaccoCountMessage,
  fetchVenueName,
  sendTelegramMessage,
} from './telegramNotify.js';

const PAYMENT_METHODS = ['cash', 'card', 'other', 'qr'];

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function fetchCashMovementTotals(shiftId) {
  const { rows } = await pool.query(
    `SELECT type, COALESCE(SUM(amount), 0) AS amount
     FROM cash_movements
     WHERE shift_id = $1
     GROUP BY type`,
    [shiftId]
  );
  const totals = { deposit: 0, withdrawal: 0 };
  for (const row of rows) {
    if (row.type === 'deposit' || row.type === 'withdrawal') {
      totals[row.type] = Number(row.amount);
    }
  }
  return totals;
}

async function fetchShiftStats(shift) {
  const { rows: totalsRows } = await pool.query(
    `SELECT COUNT(*) AS receipts_count, COALESCE(SUM(total), 0) AS revenue_total
     FROM receipts WHERE shift_id = $1 AND status = 'paid'`,
    [shift.id]
  );
  const receiptsCount = Number(totalsRows[0].receipts_count);
  const revenueTotal = Number(totalsRows[0].revenue_total);

  const { rows: paymentRows } = await pool.query(
    `SELECT rp.method, COALESCE(SUM(rp.amount), 0) AS amount
     FROM receipt_payments rp
     JOIN receipts r ON r.id = rp.receipt_id
     WHERE r.shift_id = $1 AND r.status = 'paid'
     GROUP BY rp.method`,
    [shift.id]
  );
  const paymentBreakdown = { cash: 0, card: 0, other: 0, qr: 0 };
  for (const row of paymentRows) {
    if (PAYMENT_METHODS.includes(row.method)) {
      paymentBreakdown[row.method] = Number(row.amount);
    }
  }

  const movements = await fetchCashMovementTotals(shift.id);
  const openingCash = Number(shift.opening_cash || 0);
  const expectedCash = roundMoney(
    openingCash + paymentBreakdown.cash + movements.deposit - movements.withdrawal
  );

  return {
    receiptsCount,
    revenueTotal,
    paymentBreakdown,
    cash: {
      deposits: movements.deposit,
      withdrawals: movements.withdrawal,
      expectedCash,
      countedCash: shift.closing_cash != null ? Number(shift.closing_cash) : null,
    },
  };
}

export async function listRecentClosedShifts({ venueId = null, limit = 25 } = {}) {
  const params = [];
  const conditions = [`s.status = 'closed'`];
  if (venueId) {
    params.push(Number(venueId));
    conditions.push(`s.venue_id = $${params.length}`);
  }
  params.push(Math.min(80, Math.max(1, Number(limit) || 25)));
  const { rows } = await pool.query(
    `SELECT s.id, s.venue_id, v.name AS venue_name,
            s.closed_at, s.closed_by_name, s.revenue_total, s.closing_cash
     FROM shifts s
     JOIN venues v ON v.id = s.venue_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.closed_at DESC NULLS LAST, s.id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    closedAt: row.closed_at,
    closedByName: row.closed_by_name,
    revenueTotal: Number(row.revenue_total || 0),
    closingCash: row.closing_cash != null ? Number(row.closing_cash) : null,
  }));
}

export async function loadShift(shiftId) {
  const { rows } = await pool.query('SELECT * FROM shifts WHERE id = $1', [shiftId]);
  return rows[0] || null;
}

/**
 * Отправляет в Telegram отчёт о закрытии смены и учёт табака (если был).
 * force=true — ручной повтор, даже если канал помечен выключенным, но токен есть.
 */
export async function sendClosedShiftTelegramAlerts({
  shiftId,
  shift: shiftArg = null,
  stats: statsArg = null,
  venueName: venueNameArg = null,
  cashier = null,
  tobaccoCount: tobaccoArg,
  venueTobacco: tobaccoSettingsArg,
  when = null,
  force = false,
  resent = false,
} = {}) {
  const shift = shiftArg || (await loadShift(shiftId));
  if (!shift) {
    const err = new Error('Смена не найдена');
    err.code = 'SHIFT_NOT_FOUND';
    throw err;
  }
  if (shift.status !== 'closed') {
    const err = new Error('Смена ещё открыта — отчёт о закрытии можно отправить только после закрытия');
    err.code = 'SHIFT_OPEN';
    throw err;
  }

  const venueId = shift.venue_id;
  const stats = statsArg || (await fetchShiftStats(shift));
  const venueName = venueNameArg || (await fetchVenueName(venueId));
  const venueTobacco = tobaccoSettingsArg ?? (await fetchVenueTobaccoSettings(venueId));
  let tobaccoCount = tobaccoArg;
  if (tobaccoCount === undefined && venueTobacco?.tobacco_accounting_enabled) {
    tobaccoCount = await fetchShiftTobaccoCount(shift.id);
  }

  const countedCash =
    shift.closing_cash != null ? Number(shift.closing_cash) : stats.cash.countedCash;
  const expectedCash =
    shift.closing_cash_expected != null
      ? Number(shift.closing_cash_expected)
      : stats.cash.expectedCash;

  const prefix = resent ? '↻ Повтор отчёта о закрытии смены\n' : '';
  const closeText =
    prefix +
    buildShiftCloseMessage({
      venueName,
      closingCash: countedCash,
      expectedCash,
      revenueTotal: stats.revenueTotal,
      cashSales: stats.paymentBreakdown.cash,
      cardSales: stats.paymentBreakdown.card,
      qrSales: stats.paymentBreakdown.qr,
      otherSales: stats.paymentBreakdown.other,
      receiptsCount: stats.receiptsCount,
      deposits: stats.cash.deposits,
      withdrawals: stats.cash.withdrawals,
      cashier: cashier || shift.closed_by_name,
      when: when || shift.closed_at || new Date(),
    });

  const close = await sendTelegramMessage(closeText, { venueId, force });
  if (close?.skipped) {
    const err = new Error(
      close.reason === 'no_channel'
        ? `Для «${venueName}» не настроен Telegram-канал`
        : `Канал для «${venueName}» выключен или без токена / chat id`
    );
    err.code = 'TELEGRAM_SKIPPED';
    throw err;
  }

  let tobacco = null;
  if (venueTobacco?.tobacco_accounting_enabled && tobaccoCount) {
    const tobaccoText =
      (resent ? '↻ Повтор учёта табака\n' : '') +
      buildTobaccoCountMessage({
        venueName,
        cashier: cashier || tobaccoCount.countedByName || shift.closed_by_name,
        when: when || tobaccoCount.countedAt || shift.closed_at || new Date(),
        skipped: !!tobaccoCount.skipped,
        totalNetG: tobaccoCount.totalNetG,
        totalExpectedG: tobaccoCount.totalExpectedG,
        withinTolerance: tobaccoCount.withinTolerance,
        toleranceG: Number(venueTobacco.tobacco_tolerance_g),
        lines: tobaccoCount.lines || [],
      });
    tobacco = await sendTelegramMessage(tobaccoText, { venueId, force });
  }

  return {
    venueName,
    shiftId: shift.id,
    close,
    tobacco,
    sentTobacco: Boolean(tobacco && !tobacco.skipped),
  };
}

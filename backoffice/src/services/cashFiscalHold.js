// Ручная отправка наличных чеков в АТОЛ.
// Чек не прячется от фискализации: задание просто не попадает в очередь,
// пока его не отправят из бэкофиса. Планшет задание не видит и продажу не стопорит.
// Z (close_shift) держится в статусе deferred, чтобы касса не закрыла смену
// раньше этих чеков. В уже напечатанный Z чек добавить нельзя.

export async function ensureAtolCashHoldSchema() {
  const { pool } = await import('../db.js');
  await pool.query(
    `ALTER TABLE venue_atol_settings
     ADD COLUMN IF NOT EXISTS hold_cash_receipts BOOLEAN NOT NULL DEFAULT false`
  );
  await pool.query(`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS fiscal_hold_payload JSONB`);
}

export const FISCAL_SHIFT_HOLD_HOURS = 22;

export const FISCAL_SEND_CLOSED =
  'Фискальная смена уже закрыта Z-отчётом. В закрытый отчёт чек добавить нельзя. Когда на точке откроют следующую смену, кнопка отправит чек уже в неё — он попадёт в следующий Z, не в прошлый.';

export const FISCAL_SEND_CLOSING =
  'Касса уже печатает Z-отчёт. Этот чек в него не успеет. Дождитесь открытия следующей смены и отправьте чек туда.';

export const FISCAL_SEND_NO_SHIFT =
  'Фискальная смена на кассе не открыта. Чек можно отправить, когда планшет откроет смену на кассе. В уже закрытый Z он не попадает.';

export const DEFERRED_CLOSE_EXPIRED =
  'Фискальная смена открыта больше 22 часов. Отложенный Z снят: касса не держит смену дольше 24 часов. Неотправленные наличные чеки попадут в следующую фискальную смену, не в этот Z.';

export const DEFERRED_CLOSE_REPLACED =
  'Отложенный Z заменён: наличные чеки уже в очереди кассы, отчёт уйдёт следом.';

export function isPureCashSale(payments) {
  return Array.isArray(payments) && payments.length > 0 && payments.every((p) => p.method === 'cash');
}

export function shouldHoldCashReceipt({ holdCash, payments, total }) {
  if (!holdCash) return false;
  if (!(Number(total) > 0.009)) return false;
  return isPureCashSale(payments);
}

/** Можно ли поставить чек в очередь кассы прямо сейчас. */
export function decideFiscalSend({ opens, closes }) {
  const lastOpen = [...(opens || [])]
    .filter((job) => job.status === 'done')
    .sort((a, b) => b.id - a.id)[0];
  if (!lastOpen) return { ok: false, error: FISCAL_SEND_NO_SHIFT };

  const later = (closes || []).filter((job) => job.id > lastOpen.id);
  if (later.some((job) => job.status === 'done')) return { ok: false, error: FISCAL_SEND_CLOSED };
  if (later.some((job) => job.status === 'pending' || job.status === 'in_progress')) {
    return { ok: false, error: FISCAL_SEND_CLOSING };
  }
  return { ok: true };
}

/**
 * Пока есть отложенный Z и кассовая смена моложе 22 часов, новую фискальную
 * смену не открываем: иначе Z вчерашнего дня закроет уже сегодняшнюю смену
 * или касса ответит «смена уже открыта». После 22 часов отложенный Z снимаем,
 * чтобы утренняя смена не встала из‑за лимита ККТ в 24 часа.
 */
export function shouldKeepFiscalShiftForHeldCash({ hasDeferredClose, fiscalOpenAgeHours }) {
  if (!hasDeferredClose) return false;
  if (fiscalOpenAgeHours == null || !Number.isFinite(fiscalOpenAgeHours)) return false;
  return fiscalOpenAgeHours < FISCAL_SHIFT_HOLD_HOURS;
}

/**
 * deferredCloses: { id, shiftId }
 * shifts: { id, status } — смена и все более новые смены этой точки
 * blockingHeld: сколько наличных чеков ещё не проведены кассой
 */
export function planDeferredCloses({ deferredCloses, shifts, blockingHeld }) {
  const actions = { cancel: [], release: null };
  const sorted = [...(deferredCloses || [])].sort(
    (a, b) => a.shiftId - b.shiftId || a.id - b.id
  );
  for (const job of sorted) {
    const newer = (shifts || []).filter((shift) => shift.id > job.shiftId);
    if (newer.some((shift) => shift.status === 'open')) continue;
    if (newer.length > 0) {
      actions.cancel.push(job.id);
      continue;
    }
    const shift = (shifts || []).find((row) => row.id === job.shiftId);
    if (!shift || shift.status !== 'closed') continue;
    if (blockingHeld > 0) continue;
    actions.release = job.id;
  }
  return actions;
}

export async function countUnsentHeldReceipts(client, venueId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM receipts r
     WHERE r.venue_id = $1
       AND r.fiscal_hold_payload IS NOT NULL
       AND r.fiscal_status IN ('held', 'pending', 'error')
       AND NOT EXISTS (
         SELECT 1 FROM fiscal_jobs c
         WHERE c.shift_id = r.shift_id
           AND c.type = 'close_shift'
           AND c.status = 'done'
       )`,
    [venueId]
  );
  return Number(rows[0]?.count || 0);
}

export async function inspectDeferredFiscalClose(client, venueId) {
  const { rows: deferred } = await client.query(
    `SELECT 1 FROM fiscal_jobs
     WHERE venue_id = $1 AND type = 'close_shift' AND status = 'deferred'
     LIMIT 1`,
    [venueId]
  );
  const { rows: opens } = await client.query(
    `SELECT updated_at FROM fiscal_jobs
     WHERE venue_id = $1 AND type = 'open_shift' AND status = 'done'
     ORDER BY id DESC
     LIMIT 1`,
    [venueId]
  );
  const openAt = opens[0]?.updated_at ? new Date(opens[0].updated_at).getTime() : null;
  const fiscalOpenAgeHours = openAt == null ? null : (Date.now() - openAt) / 36e5;
  return { hasDeferred: Boolean(deferred[0]), fiscalOpenAgeHours };
}

export async function loadFiscalShiftJobs(client, venueId) {
  const { rows } = await client.query(
    `SELECT id, type, status
     FROM fiscal_jobs
     WHERE venue_id = $1 AND type IN ('open_shift', 'close_shift')
     ORDER BY id ASC`,
    [venueId]
  );
  return {
    opens: rows
      .filter((row) => row.type === 'open_shift')
      .map((row) => ({ id: Number(row.id), status: row.status })),
    closes: rows
      .filter((row) => row.type === 'close_shift')
      .map((row) => ({ id: Number(row.id), status: row.status })),
  };
}

export async function cancelDeferredCloses(client, venueId, message) {
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'cancelled', last_error = $2, updated_at = now()
     WHERE venue_id = $1 AND type = 'close_shift' AND status = 'deferred'`,
    [venueId, message]
  );
}

function payloadJson(payload) {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

export async function syncDeferredCloses(client, venueId) {
  const { rows: deferred } = await client.query(
    `SELECT id, shift_id, payload
     FROM fiscal_jobs
     WHERE venue_id = $1 AND type = 'close_shift' AND status = 'deferred'
     ORDER BY id ASC
     FOR UPDATE`,
    [venueId]
  );
  if (!deferred.length) return { cancelled: 0, released: false };

  const minShift = Math.min(...deferred.map((row) => Number(row.shift_id)));
  const { rows: shiftRows } = await client.query(
    `SELECT id, status FROM shifts WHERE venue_id = $1 AND id >= $2 ORDER BY id`,
    [venueId, minShift]
  );
  const blockingHeld = await countUnsentHeldReceipts(client, venueId);
  const plan = planDeferredCloses({
    deferredCloses: deferred.map((row) => ({ id: Number(row.id), shiftId: Number(row.shift_id) })),
    shifts: shiftRows.map((row) => ({ id: Number(row.id), status: row.status })),
    blockingHeld,
  });

  if (plan.cancel.length) {
    await client.query(
      `UPDATE fiscal_jobs
       SET status = 'cancelled',
           last_error = 'Z этой смены перешёл к более поздней: фискальная смена кассы оставалась открытой.',
           updated_at = now()
       WHERE id = ANY($1::int[]) AND status = 'deferred'`,
      [plan.cancel]
    );
  }

  if (!plan.release) return { cancelled: plan.cancel.length, released: false };

  const job = deferred.find((row) => Number(row.id) === plan.release);
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'cancelled', last_error = $2, updated_at = now()
     WHERE id = $1 AND status = 'deferred'`,
    [plan.release, DEFERRED_CLOSE_REPLACED]
  );
  await client.query(
    `INSERT INTO fiscal_jobs (venue_id, type, shift_id, payload, status)
     VALUES ($1, 'close_shift', $2, $3::jsonb, 'pending')`,
    [venueId, job.shift_id, payloadJson(job.payload)]
  );
  return { cancelled: plan.cancel.length, released: true };
}

export async function sendHeldCashReceipt(client, receiptId) {
  const { rows } = await client.query(
    `SELECT id, venue_id, shift_id, fiscal_status, fiscal_hold_payload
     FROM receipts
     WHERE id = $1
     FOR UPDATE`,
    [receiptId]
  );
  const receipt = rows[0];
  if (!receipt) return { ok: false, httpStatus: 404, error: 'Чек не найден' };
  if (!receipt.fiscal_hold_payload || !['held', 'error'].includes(receipt.fiscal_status)) {
    return { ok: false, httpStatus: 409, error: 'Этот чек не ждёт ручной отправки' };
  }

  const { rows: activeJobs } = await client.query(
    `SELECT id, status
     FROM fiscal_jobs
     WHERE receipt_id = $1
       AND type IN ('receipt', 'receipt_return')
       AND status IN ('pending', 'in_progress', 'done')
     ORDER BY id DESC
     LIMIT 1`,
    [receiptId]
  );
  if (activeJobs[0]) {
    return { ok: false, httpStatus: 409, error: 'По этому чеку уже есть задание в кассу' };
  }

  const shiftJobs = await loadFiscalShiftJobs(client, receipt.venue_id);
  const decision = decideFiscalSend(shiftJobs);
  if (!decision.ok) return { ok: false, httpStatus: 409, error: decision.error };

  const payload = receipt.fiscal_hold_payload;
  const jobType = payload?.type === 'sellReturn' ? 'receipt_return' : 'receipt';
  const { rows: errorJobs } = await client.query(
    `SELECT id FROM fiscal_jobs
     WHERE receipt_id = $1 AND type = $2 AND status = 'error'
     ORDER BY id DESC
     LIMIT 1`,
    [receiptId, jobType]
  );
  if (errorJobs[0] && receipt.fiscal_status === 'error') {
    await client.query(
      `UPDATE fiscal_jobs
       SET status = 'pending', last_error = NULL, updated_at = now()
       WHERE id = $1`,
      [errorJobs[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO fiscal_jobs (venue_id, type, receipt_id, shift_id, payload, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')`,
      [receipt.venue_id, jobType, receipt.id, receipt.shift_id, payloadJson(payload)]
    );
  }
  await client.query(`UPDATE receipts SET fiscal_status = 'pending' WHERE id = $1`, [receipt.id]);
  return { ok: true, venueId: receipt.venue_id };
}

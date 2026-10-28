// Ручная отправка наличных чеков в АТОЛ.
// Весь режим включается только галочкой venue_atol_settings.hold_cash_receipts.
// Пока она снята, чеки и Z уходят как раньше, персонал ничего не замечает.
// В уже напечатанный Z чек добавить нельзя: касса собирает Z сама из принятых документов.

export async function ensureAtolCashHoldSchema() {
  const { pool } = await import('../db.js');
  await pool.query(
    `ALTER TABLE venue_atol_settings
     ADD COLUMN IF NOT EXISTS hold_cash_receipts BOOLEAN NOT NULL DEFAULT false`
  );
  await pool.query(`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS fiscal_hold_payload JSONB`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS fiscal_reconcile JSONB`);
}

export const FISCAL_SEND_CLOSED =
  'Фискальная смена этого чека уже закрыта Z-отчётом. В закрытый Z чек добавить нельзя. Когда на точке откроют следующую смену, кнопка отправит его в неё.';

export const FISCAL_SEND_CLOSING =
  'Касса уже печатает Z-отчёт. Этот чек в него не успеет. Дождитесь открытия следующей смены и отправьте чек туда.';

export const FISCAL_SEND_NO_SHIFT =
  'Фискальная смена на кассе не открыта. Чек можно отправить, когда планшет откроет смену на кассе. В уже закрытый Z он не попадает.';

export function unsentCashNote(count, total, { zSkipped = false } = {}) {
  const n = Number(count) || 0;
  const parts = [];
  if (n > 0) {
    const money = (Number(total) || 0).toFixed(2);
    parts.push(
      `Из них не отправлено в АТОЛ: ${n} на ${money} ₽. В строке «Наличные оплаты» эта сумма уже учтена.`
    );
  }
  if (zSkipped) {
    parts.push('Z на кассу не отправлялся. Смена в программе закрыта, Z печатается кнопкой в бэкофисе.');
  }
  return parts.length ? parts.join(' ') : null;
}

/** Пока ручная отправка включена, закрытие смены в программе не ставит Z в очередь кассы. */
export function shouldEnqueueFiscalClose(holdCash) {
  return !holdCash;
}

/** Фискальная смена ещё открыта: был успешный open_shift и после него Z не напечатан и не в очереди. */
export function fiscalShiftIsOpen(opens, closes) {
  const lastOpen = [...(opens || [])]
    .filter((job) => job.status === 'done')
    .sort((a, b) => b.id - a.id)[0];
  if (!lastOpen) return false;
  const later = (closes || []).filter((job) => job.id > lastOpen.id);
  return !later.some((job) => job.status === 'done' || job.status === 'pending' || job.status === 'in_progress');
}

/** Не открывать вторую фискальную смену, если предыдущий Z ещё не отправлен. */
export function shouldEnqueueFiscalOpen({ holdCash, fiscalShiftOpen }) {
  if (holdCash && fiscalShiftOpen) return false;
  return true;
}

/** Кнопка Z в бэкофисе не подменяет закрытие смены персоналом и не принимает суммы. */
export function zButtonDecision({ shiftStatus, closeStatus, newerOpenDone }) {
  if (shiftStatus !== 'closed') {
    return {
      ok: false,
      error: 'Смена в программе ещё открыта. Её закрывают на планшете. Z отсюда уходит только после закрытия.',
    };
  }
  if (newerOpenDone) {
    return {
      ok: false,
      error: 'Следующая смена уже открыта на кассе. Этот Z отправить нельзя: касса закрыла бы текущую смену.',
    };
  }
  if (closeStatus === 'done') return { ok: false, done: true, error: 'Z уже напечатан.' };
  if (closeStatus === 'pending' || closeStatus === 'in_progress') {
    return { ok: false, error: 'Z уже в очереди кассы.' };
  }
  if (closeStatus === 'error' || closeStatus === 'cancelled' || closeStatus === 'deferred') {
    return { ok: true, action: 'retry' };
  }
  return { ok: true, action: 'enqueue' };
}

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

function payloadJson(payload) {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
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

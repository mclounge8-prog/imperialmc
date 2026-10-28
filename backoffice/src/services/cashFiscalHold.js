// Ручная отправка части наличных чеков в АТОЛ.
// Весь режим включается только галочкой venue_atol_settings.hold_cash_receipts.
// Пока она снята, чеки и Z уходят как раньше.
// При включённой ручке в Z сами попадают только мелкие наличные чеки по квоте.
// Остальные помечаются и отправляются кнопкой в любую следующую открытую фискальную смену.
// Z при закрытии смены уходит всегда. В уже напечатанный Z чек добавить нельзя.

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

export function unsentCashNote(count, total) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  const money = (Number(total) || 0).toFixed(2);
  return `Из них не в ОФД: ${n} на ${money} ₽. В строке «Наличные оплаты» эта сумма уже учтена. В Z эти чеки не входят.`;
}

/** Сколько наличных чеков ушло в кассу, а сколько помечено и осталось вне Z. */
export function ofdSplitNote({ cashCount, sentCount, unsentCount, unsentTotal }) {
  const unsent = Number(unsentCount) || 0;
  if (unsent <= 0) return null;
  const money = (Number(unsentTotal) || 0).toFixed(2);
  return `Наличных чеков: ${Number(cashCount) || 0}. В ОФД: ${Number(sentCount) || 0}. Не в ОФД: ${unsent} на ${money} ₽. В «Наличные оплаты» входят все. В Z только отправленные.`;
}

/**
 * Квота автоотправки наличных.
 * Меньше 10 чеков за смену или меньше 3 наличных — сами не отправляем.
 * Дальше один самый мелкий на каждые 40 чеков смены, но не меньше одного:
 * 10 чеков → 1, 80 чеков → 2.
 */
export function autoCashSendQuota({ totalReceipts, cashReceipts }) {
  const total = Number(totalReceipts) || 0;
  const cash = Number(cashReceipts) || 0;
  if (total < 10 || cash < 3) return 0;
  return Math.min(cash, Math.max(1, Math.floor(total / 40)));
}

/** Самые мелкие ещё не отправленные наличные, чтобы добрать квоту. Уже ушедшие в кассу квоту занимают. */
export function pickHeldCashToSend(receipts, quota) {
  const list = Array.isArray(receipts) ? receipts : [];
  const already = list.filter((row) => row.fiscalStatus === 'done' || row.fiscalStatus === 'pending').length;
  const need = Math.max(0, Number(quota) - already);
  return list
    .filter((row) => row.fiscalStatus === 'held')
    .slice()
    .sort((a, b) => {
      const byTotal = Number(a.total) - Number(b.total);
      if (byTotal !== 0) return byTotal;
      return Number(a.id) - Number(b.id);
    })
    .slice(0, need)
    .map((row) => Number(row.id));
}

const PURE_CASH_SQL = `
  SELECT r.id, r.total, r.fiscal_status, r.closed_at,
    (SELECT j.last_error FROM fiscal_jobs j
     WHERE j.receipt_id = r.id AND j.last_error IS NOT NULL
     ORDER BY j.id DESC LIMIT 1) AS last_error
  FROM receipts r
  WHERE r.shift_id = $1
    AND r.status = 'paid'
    AND r.total > 0.009
    AND EXISTS (
      SELECT 1 FROM receipt_payments rp
      WHERE rp.receipt_id = r.id AND rp.method = 'cash'
    )
    AND NOT EXISTS (
      SELECT 1 FROM receipt_payments rp
      WHERE rp.receipt_id = r.id AND rp.method <> 'cash'
    )
`;

export async function loadCashOfdSplit(client, shiftId) {
  const { rows: totalRows } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM receipts
     WHERE shift_id = $1 AND status = 'paid' AND total > 0.009`,
    [shiftId]
  );
  const { rows } = await client.query(PURE_CASH_SQL, [shiftId]);
  const sent = rows.filter((row) => row.fiscal_status === 'done' || row.fiscal_status === 'pending');
  const unsent = rows.filter((row) => row.fiscal_status === 'held' || row.fiscal_status === 'error');
  return {
    totalReceipts: Number(totalRows[0]?.n || 0),
    cashCount: rows.length,
    sentCount: sent.length,
    unsentCount: unsent.length,
    unsentTotal: unsent.reduce((sum, row) => sum + Number(row.total || 0), 0),
    receipts: rows.map((row) => ({
      id: Number(row.id),
      total: Number(row.total),
      fiscalStatus: row.fiscal_status,
      closedAt: row.closed_at || null,
      lastError: row.last_error || null,
    })),
  };
}

/** Перед Z ставит в очередь самые мелкие наличные чеки в пределах квоты. */
export async function queueAutoCashBeforeZ(client, shiftId) {
  const before = await loadCashOfdSplit(client, shiftId);
  const quota = autoCashSendQuota({
    totalReceipts: before.totalReceipts,
    cashReceipts: before.cashCount,
  });
  const ids = pickHeldCashToSend(before.receipts, quota);
  const queuedIds = [];
  for (const id of ids) {
    const sent = await sendHeldCashReceipt(client, id);
    if (sent.ok) queuedIds.push(id);
  }
  const after = await loadCashOfdSplit(client, shiftId);
  return { ...after, quota, queuedIds };
}

function moneyRub(value) {
  return `${(Number(value) || 0).toFixed(2)} ₽`;
}

function formatReceiptTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sumTotals(rows) {
  return rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
}

function receiptMark(row) {
  const extra = [];
  const when = formatReceiptTime(row.closedAt);
  if (when) extra.push(when);
  if (row.fiscalStatus === 'pending') extra.push('в очереди на кассу');
  if (row.fiscalStatus === 'done') extra.push('уже в кассе');
  if (row.fiscalStatus === 'error') extra.push('касса не приняла');
  const error = String(row.lastError || '').replace(/\s+/g, ' ').trim();
  if (row.fiscalStatus === 'error' && error) extra.push(error.slice(0, 80));
  const tail = extra.length ? ` · ${extra.join(' · ')}` : '';
  return `• №${Number(row.id)} · ${moneyRub(row.total)}${tail}`;
}

function listReceiptLines(rows) {
  const sorted = rows
    .slice()
    .sort((a, b) => Number(a.total) - Number(b.total) || Number(a.id) - Number(b.id));
  const shown = sorted.slice(0, 30).map(receiptMark);
  if (sorted.length > 30) shown.push(`… и ещё ${sorted.length - 30}`);
  return shown;
}

function quotaLine(quota, totalReceipts, cashReceipts) {
  if (quota > 0) return `Квота автоотправки: ${quota} самых мелких`;
  if (totalReceipts < 10) return 'Квота автоотправки: 0, чеков меньше 10';
  if (cashReceipts < 3) return 'Квота автоотправки: 0, наличных меньше 3';
  return 'Квота автоотправки: 0';
}

/** Строки для Telegram: что попало в этот Z и что осталось с маркером. */
export function cashOfdReportLines({ totalReceipts, receipts, quota }) {
  const list = Array.isArray(receipts) ? receipts : [];
  const total = Number(totalReceipts) || 0;
  const cash = list.length;
  const autoQuota = quota == null
    ? autoCashSendQuota({ totalReceipts: total, cashReceipts: cash })
    : Number(quota) || 0;
  const sent = list.filter((row) => row.fiscalStatus === 'done' || row.fiscalStatus === 'pending');
  const unsent = list.filter((row) => row.fiscalStatus === 'held' || row.fiscalStatus === 'error');
  const lines = [
    `Чеков за смену: ${total}`,
    `Наличных чеков: ${cash} на ${moneyRub(sumTotals(list))}`,
    quotaLine(autoQuota, total, cash),
    `В этот Z: ${sent.length} на ${moneyRub(sumTotals(sent))}`,
    ...listReceiptLines(sent),
    `Не в ОФД: ${unsent.length} на ${moneyRub(sumTotals(unsent))}`,
    ...listReceiptLines(unsent),
    'Z уходит с закрытием. В нём только чеки, которые касса приняла.',
  ];
  if (unsent.length > 0) {
    lines.push('Не в ОФД можно отправить в следующую открытую смену.');
  }
  return lines;
}

/** Z при закрытии смены уходит всегда, и с ручкой, и без неё. */
export function shouldEnqueueFiscalClose() {
  return true;
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

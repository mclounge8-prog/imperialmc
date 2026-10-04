// Защита очереди АТОЛ: старый close_shift нельзя отправлять на кассу,
// если уже успешно открыта следующая смена. closeShift на ККТ закрывает
// ТЕКУЩУЮ фискальную смену, а не ту, что записана в payload — из‑за этого
// Z-отчёт «вчерашнего» кассира печатался посреди новой смены, а бэкофис
// оставался чистым (учётная смена уже была закрыта вчера).

export const SUPERSEDED_CLOSE_MSG =
  'Просрочено: уже открыта следующая смена. Старый Z-отчёт не отправлен — иначе касса закрыла бы текущую смену.';

export const SUPERSEDED_OPEN_MSG =
  'Просрочено: уже открыта более новая смена. Повторное открытие на кассе не отправлено.';

const STUCK_MINUTES = 2;
const MAX_RECLAIM_ATTEMPTS = 8;

export const STUCK_RECEIPT_MSG =
  'Нет ответа кассы после отправки чека. Автоповтор отключён, чтобы не пробить дважды. Если чека нет на ленте — нажмите Повторить.';

export async function hasNewerOpenShiftDone(client, venueId, shiftId) {
  if (!venueId || !shiftId) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM fiscal_jobs
     WHERE venue_id = $1 AND type = 'open_shift' AND status = 'done' AND shift_id > $2
     LIMIT 1`,
    [venueId, shiftId]
  );
  return Boolean(rows[0]);
}

export async function hasNewerShift(client, venueId, shiftId) {
  if (!venueId || !shiftId) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM shifts WHERE venue_id = $1 AND id > $2 LIMIT 1`,
    [venueId, shiftId]
  );
  return Boolean(rows[0]);
}

export async function cancelJob(client, jobId, message) {
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'cancelled', last_error = $2, updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'in_progress', 'error')`,
    [jobId, message]
  );
}

/** true — задание отменено, на кассу отправлять нельзя. */
export async function cancelIfSuperseded(client, job) {
  if (!job) return false;
  if (job.type === 'close_shift') {
    const unsafe = await hasNewerOpenShiftDone(client, job.venue_id, job.shift_id);
    if (!unsafe) return false;
    await cancelJob(client, job.id, SUPERSEDED_CLOSE_MSG);
    return true;
  }
  if (job.type === 'open_shift') {
    const unsafe = await hasNewerShift(client, job.venue_id, job.shift_id);
    if (!unsafe) return false;
    await cancelJob(client, job.id, SUPERSEDED_OPEN_MSG);
    return true;
  }
  return false;
}

export async function cancelSupersededShiftJobs(client, venueId = null) {
  await client.query(
    `UPDATE fiscal_jobs c
     SET status = 'cancelled', last_error = $1, updated_at = now()
     WHERE c.type = 'close_shift'
       AND c.status IN ('pending', 'in_progress', 'error')
       AND ($2::int IS NULL OR c.venue_id = $2)
       AND EXISTS (
         SELECT 1 FROM fiscal_jobs o
         WHERE o.venue_id = c.venue_id
           AND o.type = 'open_shift'
           AND o.status = 'done'
           AND o.shift_id > c.shift_id
       )`,
    [SUPERSEDED_CLOSE_MSG, venueId]
  );
  await client.query(
    `UPDATE fiscal_jobs o
     SET status = 'cancelled', last_error = $1, updated_at = now()
     WHERE o.type = 'open_shift'
       AND o.status IN ('pending', 'in_progress', 'error')
       AND ($2::int IS NULL OR o.venue_id = $2)
       AND EXISTS (
         SELECT 1 FROM shifts s
         WHERE s.venue_id = o.venue_id AND s.id > o.shift_id
       )`,
    [SUPERSEDED_OPEN_MSG, venueId]
  );
}

export async function reclaimStuckInProgress(client, venueId = null) {
  await cancelSupersededShiftJobs(client, venueId);
  // Чек, зависший после отправки на ККТ, нельзя возвращать в pending:
  // касса часто уже пробила, а повторный sell даёт второй ФД (Карла 04.10).
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'error', last_error = $1, updated_at = now()
     WHERE status = 'in_progress'
       AND type IN ('receipt', 'receipt_return')
       AND updated_at < now() - ($2::text || ' minutes')::interval
       AND ($3::int IS NULL OR venue_id = $3)`,
    [STUCK_RECEIPT_MSG, String(STUCK_MINUTES), venueId]
  );
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'pending', updated_at = now()
     WHERE status = 'in_progress'
       AND type NOT IN ('receipt', 'receipt_return')
       AND updated_at < now() - ($1::text || ' minutes')::interval
       AND attempts < $2
       AND ($3::int IS NULL OR venue_id = $3)`,
    [String(STUCK_MINUTES), MAX_RECLAIM_ATTEMPTS, venueId]
  );
  await client.query(
    `UPDATE fiscal_jobs
     SET status = 'error',
         last_error = COALESCE(last_error, 'Задание зависло в in_progress и сброшено'),
         updated_at = now()
     WHERE status = 'in_progress'
       AND updated_at < now() - ($1::text || ' minutes')::interval
       AND attempts >= $2
       AND ($3::int IS NULL OR venue_id = $3)`,
    [String(STUCK_MINUTES), MAX_RECLAIM_ATTEMPTS, venueId]
  );
}

// TTL-очистка очереди фискальных заданий. Журнал в бэкофисе показывает
// только свежие записи; старые done/error удаляем, чтобы таблица не росла
// бесконечно и не тормозила SELECT ... FOR UPDATE SKIP LOCKED.
import { pool } from '../db.js';

const RETENTION_DAYS = 7;
const PENDING_STUCK_HOURS = 24;

export async function pruneFiscalJobs() {
  // Завершённые задания старше RETENTION_DAYS.
  await pool.query(
    `DELETE FROM fiscal_jobs
     WHERE status IN ('done', 'error')
       AND created_at < now() - ($1::text || ' days')::interval`,
    [String(RETENTION_DAYS)]
  );

  // Зависшие in_progress (терминал умер посреди задания) — возвращаем в очередь
  // один раз, а если attempts уже большие и старше суток — помечаем error.
  await pool.query(
    `UPDATE fiscal_jobs
     SET status = 'pending', updated_at = now()
     WHERE status = 'in_progress'
       AND updated_at < now() - ($1::text || ' hours')::interval
       AND attempts < 5`,
    [String(PENDING_STUCK_HOURS)]
  );
  await pool.query(
    `UPDATE fiscal_jobs
     SET status = 'error',
         last_error = COALESCE(last_error, 'Задание зависло в in_progress и сброшено по TTL'),
         updated_at = now()
     WHERE status = 'in_progress'
       AND updated_at < now() - ($1::text || ' hours')::interval
       AND attempts >= 5`,
    [String(PENDING_STUCK_HOURS)]
  );
}

export function startFiscalJobsCleanup({ intervalMs = 60 * 60 * 1000 } = {}) {
  const tick = () => {
    pruneFiscalJobs().catch((err) => {
      console.warn('[fiscalCleanup] не удалось почистить fiscal_jobs:', err.message || err);
    });
  };
  tick();
  return setInterval(tick, intervalMs);
}

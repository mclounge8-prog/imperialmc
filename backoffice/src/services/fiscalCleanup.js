// TTL-очистка очереди фискальных заданий. Журнал в бэкофисе показывает
// только свежие записи; старые done/error/cancelled удаляем, чтобы таблица
// не росла бесконечно и не тормозила SELECT ... FOR UPDATE SKIP LOCKED.
import { pool } from '../db.js';
import { reclaimStuckInProgress } from './fiscalJobGuards.js';

const RETENTION_DAYS = 7;

export async function pruneFiscalJobs() {
  await reclaimStuckInProgress(pool);

  await pool.query(
    `DELETE FROM fiscal_jobs
     WHERE status IN ('done', 'error', 'cancelled')
       AND created_at < now() - ($1::text || ' days')::interval`,
    [String(RETENTION_DAYS)]
  );
}

export function startFiscalJobsCleanup({ intervalMs = 60 * 1000 } = {}) {
  const tick = () => {
    pruneFiscalJobs().catch((err) => {
      console.warn('[fiscalCleanup] не удалось почистить fiscal_jobs:', err.message || err);
    });
  };
  tick();
  return setInterval(tick, intervalMs);
}

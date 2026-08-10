// JSON API для терминала — фискализация чеков/смен через кассу АТОЛ,
// подключённую к той же локальной сети, что и планшет. Backend только
// собирает JSON-задания и кладёт их в очередь (см. services/fiscalQueue.js),
// а выполняет их сам terminal-app через нативный модуль (см.
// terminal-app/android/app/src/main/java/.../atol/AtolModule.kt), который
// общается с отдельно установленным на планшет приложением "Драйвер ККТ
// АТОЛ" по TCP/IP — backend саму кассу никогда не видит, она не в его сети.
import { Hono } from 'hono';
import { pool } from '../db.js';
import { requireStaffToken } from '../middleware/apiAuth.js';

const apiFiscal = new Hono();
apiFiscal.use('*', requireStaffToken);

// Настройки кассы для конкретного заведения — терминал запрашивает их один
// раз при открытии смены/экрана настроек, чтобы знать, включена ли касса
// АТОЛ и куда подключаться. enabled: false (или отсутствие строки) — касса
// не используется, terminal-app должен просто не фискализировать.
apiFiscal.get('/settings', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows } = await pool.query(
    'SELECT enabled, kkt_ip, kkt_port, kkt_model, operator_name FROM venue_atol_settings WHERE venue_id = $1',
    [venueId]
  );
  const settings = rows[0];
  if (!settings || !settings.enabled) {
    return c.json({ enabled: false });
  }

  return c.json({
    enabled: true,
    ipAddress: settings.kkt_ip,
    ipPort: settings.kkt_port,
    model: settings.kkt_model,
    operatorName: settings.operator_name,
  });
});

// Следующее необработанное задание для этого заведения (если есть). Забирает
// самое старое pending-задание и сразу переводит его в in_progress — так
// повторный опрос (например, если терминал перезапустили) не возьмёт то же
// задание дважды, пока предыдущая попытка ещё не отчиталась результатом.
apiFiscal.get('/jobs/next', async (c) => {
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, type, receipt_id, shift_id, payload, attempts
       FROM fiscal_jobs
       WHERE venue_id = $1 AND status = 'pending'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [venueId]
    );
    const job = rows[0];
    if (!job) {
      await client.query('COMMIT');
      return c.json({ job: null });
    }

    await client.query(
      "UPDATE fiscal_jobs SET status = 'in_progress', attempts = attempts + 1, updated_at = now() WHERE id = $1",
      [job.id]
    );
    await client.query('COMMIT');

    return c.json({
      job: {
        id: job.id,
        type: job.type,
        receiptId: job.receipt_id,
        shiftId: job.shift_id,
        payload: job.payload,
        attempts: job.attempts + 1,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Список последних заданий для экрана «Касса АТОЛ» в терминале —
// статусы, ошибки, ФД/ФПД. Не забирает задания из очереди (в отличие от /jobs/next).
apiFiscal.get('/jobs', async (c) => {
  const venueId = c.req.query('venueId');
  const limitRaw = Number(c.req.query('limit') || 30);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rows } = await pool.query(
    `SELECT id, type, status, receipt_id, shift_id, attempts, last_error,
            fiscal_doc_number, fiscal_sign, fiscal_datetime, created_at, updated_at
     FROM fiscal_jobs
     WHERE venue_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [venueId, limit]
  );

  const { rows: errorCountRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fiscal_jobs WHERE venue_id = $1 AND status = 'error'`,
    [venueId]
  );

  return c.json({
    errorCount: errorCountRows[0]?.count || 0,
    jobs: rows.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      receiptId: job.receipt_id,
      shiftId: job.shift_id,
      attempts: job.attempts,
      lastError: job.last_error,
      fiscalDocNumber: job.fiscal_doc_number,
      fiscalSign: job.fiscal_sign,
      fiscalDatetime: job.fiscal_datetime,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    })),
  });
});

// Вернуть упавшее задание в очередь — терминал подхватит при следующем опросе.
apiFiscal.post('/jobs/:id/retry', async (c) => {
  const jobId = c.req.param('id');
  const venueId = c.req.query('venueId');
  if (!venueId) {
    c.status(400);
    return c.json({ error: 'Не указано заведение' });
  }

  const { rowCount } = await pool.query(
    `UPDATE fiscal_jobs
     SET status = 'pending', last_error = NULL, updated_at = now()
     WHERE id = $1 AND venue_id = $2 AND status = 'error'`,
    [jobId, venueId]
  );
  if (!rowCount) {
    c.status(404);
    return c.json({ error: 'Задание не найдено или уже не в статусе error' });
  }
  return c.json({ ok: true });
});

// Терминал репортит результат выполнения задания на кассе.
apiFiscal.post('/jobs/:id/result', async (c) => {
  const jobId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.success !== 'boolean') {
    c.status(400);
    return c.json({ error: 'Некорректное тело запроса' });
  }

  const { rows: jobRows } = await pool.query('SELECT * FROM fiscal_jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) {
    c.status(404);
    return c.json({ error: 'Задание не найдено' });
  }

  if (body.success) {
    await pool.query(
      `UPDATE fiscal_jobs
       SET status = 'done', last_error = NULL, fiscal_doc_number = $1, fiscal_sign = $2,
           fiscal_datetime = $3, updated_at = now()
       WHERE id = $4`,
      [body.fiscalDocNumber || null, body.fiscalSign || null, body.fiscalDatetime || null, jobId]
    );
    if (job.type === 'receipt' && job.receipt_id) {
      await pool.query(
        "UPDATE receipts SET fiscal_status = 'done', fiscal_doc_number = $1 WHERE id = $2",
        [body.fiscalDocNumber || null, job.receipt_id]
      );
    }
  } else {
    await pool.query(
      "UPDATE fiscal_jobs SET status = 'error', last_error = $1, updated_at = now() WHERE id = $2",
      [body.error || 'Неизвестная ошибка терминала', jobId]
    );
    if (job.type === 'receipt' && job.receipt_id) {
      await pool.query("UPDATE receipts SET fiscal_status = 'error' WHERE id = $1", [job.receipt_id]);
    }
  }

  return c.json({ ok: true });
});

export default apiFiscal;

// API для фискального агента (см. /atol-agent) — отдельный процесс, который
// крутится на ПК в локальной сети конкретной точки, рядом с кассой АТОЛ.
// Backend сюда никогда не пишет напрямую в кассу — только кладёт задания в
// очередь (см. services/fiscalQueue.js), а агент их разбирает через этот API.
import { Hono } from 'hono';
import { pool } from '../db.js';

const apiFiscal = new Hono();

// Авторизация агента — по токену, привязанному к конкретному заведению.
// Токен генерируется/показывается один раз в бэкофисе (карточка заведения →
// «Касса АТОЛ») и вписывается в .env агента при установке на месте.
async function requireAgentToken(c, next) {
  const token = c.req.header('X-Agent-Token');
  if (!token) {
    c.status(401);
    return c.json({ error: 'Не указан токен агента' });
  }

  const { rows } = await pool.query(
    'SELECT venue_id, enabled FROM venue_atol_settings WHERE agent_token = $1',
    [token]
  );
  const settings = rows[0];
  if (!settings) {
    c.status(401);
    return c.json({ error: 'Неверный токен агента' });
  }

  await pool.query('UPDATE venue_atol_settings SET last_seen_at = now() WHERE venue_id = $1', [
    settings.venue_id,
  ]);

  c.set('venueId', settings.venue_id);
  c.set('atolEnabled', settings.enabled);
  await next();
}

apiFiscal.use('*', requireAgentToken);

// Следующее необработанное задание для этого заведения (если есть). Забирает
// самое старое pending-задание и сразу переводит его в in_progress — так
// два параллельных опроса (например, при перезапуске агента) не возьмут
// одно и то же задание дважды.
apiFiscal.get('/jobs/next', async (c) => {
  const venueId = c.get('venueId');

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

// Агент репортит результат выполнения задания на кассе.
apiFiscal.post('/jobs/:id/result', async (c) => {
  const venueId = c.get('venueId');
  const jobId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.success !== 'boolean') {
    c.status(400);
    return c.json({ error: 'Некорректное тело запроса' });
  }

  const { rows: jobRows } = await pool.query('SELECT * FROM fiscal_jobs WHERE id = $1 AND venue_id = $2', [
    jobId,
    venueId,
  ]);
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
      [body.error || 'Неизвестная ошибка агента', jobId]
    );
    if (job.type === 'receipt' && job.receipt_id) {
      await pool.query("UPDATE receipts SET fiscal_status = 'error' WHERE id = $1", [job.receipt_id]);
    }
  }

  return c.json({ ok: true });
});

export default apiFiscal;

// Фискальный агент: крутится на любом ПК в той же локальной сети, что и
// касса АТОЛ. Опрашивает backend за заданиями (открытие/закрытие смены,
// пробитие чека), выполняет их через драйвер и репортит результат обратно.
// Backend никогда не обращается к кассе напрямую — см. README.md рядом.
import 'dotenv/config';
import { AtolDriver } from './driver.js';
import { BackendClient } from './backendClient.js';

const { BACKEND_URL, AGENT_TOKEN, KKT_IP, KKT_PORT, KKT_MODEL, POLL_INTERVAL_MS } = process.env;

if (!BACKEND_URL || !AGENT_TOKEN) {
  console.error('Заполните BACKEND_URL и AGENT_TOKEN в .env (см. .env.example)');
  process.exit(1);
}

const driver = new AtolDriver({ ip: KKT_IP, port: KKT_PORT, model: KKT_MODEL });
const backend = new BackendClient({ baseUrl: BACKEND_URL, token: AGENT_TOKEN });
const pollIntervalMs = Number(POLL_INTERVAL_MS) || 3000;

let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Названия полей в ответе драйвера — предварительные (см. driver.js), при
// калибровке против реальной кассы поправьте здесь по фактическому "сырому"
// ответу, который печатается в лог ниже.
function extractFiscalInfo(response) {
  return {
    fiscalDocNumber: response?.fiscalDocumentNumber ?? response?.documentNumber ?? null,
    fiscalSign: response?.fiscalSign ?? null,
    fiscalDatetime: response?.dateTime ? new Date(response.dateTime).toISOString() : null,
  };
}

async function processOneJob() {
  const job = await backend.fetchNextJob();
  if (!job) return false;

  console.log(`[job ${job.id}] тип=${job.type} — выполняю...`);
  try {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const response = driver.runTask(payload);
    console.log(`[job ${job.id}] ответ кассы:`, JSON.stringify(response));

    await backend.reportResult(job.id, { success: true, ...extractFiscalInfo(response) });
    console.log(`[job ${job.id}] готово`);
  } catch (err) {
    const message = (err && err.message) || String(err);
    console.error(`[job ${job.id}] ошибка кассы:`, message);
    await backend.reportResult(job.id, { success: false, error: message }).catch((reportErr) => {
      console.error(`[job ${job.id}] не удалось отправить результат ошибки на backend:`, reportErr.message);
    });
  }
  return true;
}

async function loop() {
  console.log(`Фискальный агент запущен. Касса: ${KKT_IP}:${KKT_PORT || 5555}. Backend: ${BACKEND_URL}`);
  while (!stopping) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const hadJob = await processOneJob();
      if (!hadJob) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }
    } catch (err) {
      console.error('Ошибка опроса backend:', (err && err.message) || err);
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollIntervalMs);
    }
  }
}

function shutdown() {
  console.log('Останавливаюсь...');
  stopping = true;
  driver.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loop();

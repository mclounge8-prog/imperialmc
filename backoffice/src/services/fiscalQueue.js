// Очередь фискальных заданий для кассы АТОЛ. Backend никогда не обращается
// к самой кассе — она находится в локальной сети конкретной точки, а не там,
// где крутится backend. Вместо этого backend только кладёт задания в очередь
// (fiscal_jobs), а выполняет их сам terminal-app (тот же планшет, что и
// касса, в одной локальной сети): опрашивает /api/fiscal/jobs/next (см.
// terminal-app/src/services/fiscalWorker.ts), передаёт JSON-задание кассе
// через нативный модуль (AtolModule, общается по AIDL с отдельно
// установленным на планшет приложением "Драйвер ККТ АТОЛ") и репортит
// результат обратно.
//
// ВАЖНО про формат JSON в payload: ниже — предварительная схема JSON-заданий
// для драйвера ДТО10 (openShift/closeShift/sell), собранная по документации
// АТОЛ. Систему налогообложения и ставку НДС мы намеренно не передаём —
// они настроены по умолчанию на самой кассе (как было в QuickResto).
// Перед включением на реальной точке формат нужно сверить и при необходимости
// скорректировать полями через утилиту "Тест драйвера ККТ" → "Работа с JSON"
// на живой кассе — это единственный способ проверить точные названия полей
// для конкретной версии прошивки/драйвера без доступа к самому оборудованию.
import { pool } from '../db.js';

export async function fetchAtolSettings(venueId) {
  const { rows } = await pool.query('SELECT * FROM venue_atol_settings WHERE venue_id = $1', [
    venueId,
  ]);
  return rows[0] || null;
}

async function isAtolEnabledForVenue(client, venueId) {
  const { rows } = await client.query(
    'SELECT enabled FROM venue_atol_settings WHERE venue_id = $1',
    [venueId]
  );
  return !!(rows[0] && rows[0].enabled);
}

function buildSellTaskPayload({ items, payments, total, operatorName }) {
  return {
    type: 'sell',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
    positions: items.map((item) => ({
      type: 'position',
      name: item.name,
      price: Number(item.price),
      quantity: item.qty,
      amount: Math.round(Number(item.price) * item.qty * 100) / 100,
      // ФФД 1.2: 0 = штучный товар. Строку «шт» драйвер может отвергнуть.
      measurementUnit: 0,
      paymentMethod: 'fullPayment',
      paymentObject: 'commodity',
    })),
    payments: payments.map((p) => ({
      type: p.method === 'cash' ? 'cash' : 'electronically',
      sum: Number(p.amount),
    })),
    total: Number(total),
  };
}

function buildOpenShiftPayload({ operatorName }) {
  return {
    type: 'openShift',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
  };
}

function buildCloseShiftPayload({ operatorName }) {
  // closeShift в терминологии ДТО10 = печать Z-отчёта и закрытие смены одним действием
  return {
    type: 'closeShift',
    ...(operatorName ? { operator: { name: operatorName } } : {}),
  };
}

// Поставить в очередь фискализацию оплаченного чека. Тихо ничего не делает,
// если у заведения нет включённой кассы АТОЛ — весь остальной функционал
// (терминал, отчёты) продолжает работать как раньше, независимо от АТОЛ.
export async function enqueueReceiptFiscalJob(
  client,
  { venueId, receiptId, items, payments, total, operatorName }
) {
  if (!venueId) return;
  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) return;

  const payload = buildSellTaskPayload({ items, payments, total, operatorName });
  await client.query(
    `INSERT INTO fiscal_jobs (venue_id, type, receipt_id, payload) VALUES ($1, 'receipt', $2, $3)`,
    [venueId, receiptId, JSON.stringify(payload)]
  );
  await client.query("UPDATE receipts SET fiscal_status = 'pending' WHERE id = $1", [receiptId]);
}

// Поставить в очередь открытие/закрытие смены на кассе. type: 'open_shift' | 'close_shift'
export async function enqueueShiftFiscalJob(client, { venueId, shiftId, type, operatorName }) {
  if (!venueId) return;
  const enabled = await isAtolEnabledForVenue(client, venueId);
  if (!enabled) return;

  const payload =
    type === 'open_shift' ? buildOpenShiftPayload({ operatorName }) : buildCloseShiftPayload({ operatorName });

  await client.query(`INSERT INTO fiscal_jobs (venue_id, type, shift_id, payload) VALUES ($1, $2, $3, $4)`, [
    venueId,
    type,
    shiftId,
    JSON.stringify(payload),
  ]);
}

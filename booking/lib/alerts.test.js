import assert from 'node:assert/strict';
import test from 'node:test';
import { alertText, sendBookingAlert } from './alerts.js';
import { canBook } from './holds.js';

const booking = {
  table: 'Стол 8',
  zone: 'Основной зал',
  date: '2026-11-14',
  time: '19:00',
  guests: 1,
  seats: 4,
  seatPrice: 1500,
  name: 'Анна <vip>',
  phone: '79001234567',
  comment: 'у окна',
};

test('a partial table still accepts the remaining seats as one party', () => {
  assert.equal(canBook({ seats: 4, held: 1, guests: 1, bookable: true }).ok, true);
  assert.equal(canBook({ seats: 4, held: 1, guests: 3, bookable: true }).ok, true);
  assert.equal(canBook({ seats: 4, held: 1, guests: 4, bookable: true }).reason, 'full');
});

test('booking alerts name the action and escape the guest text', () => {
  const text = alertText('new', booking);
  assert.match(text, /^<b>Новая бронь<\/b>/);
  assert.match(text, /Стол 8 · Основной зал/);
  assert.match(text, /14\.11\.2026 · 19:00/);
  assert.match(text, /1 из 4 мест/);
  assert.match(text, /1\s500 ₽ за место · 1\s500 ₽/);
  assert.match(text, /Анна &lt;vip&gt;/);
  assert.match(text, /\+7 900 123-45-67/);
  assert.match(text, /у окна/);
  assert.match(alertText('reserved', booking), /Бронь подтверждена/);
  assert.match(alertText('paid', booking), /Оплата подтверждена/);
  assert.match(alertText('cancelled', booking), /Бронь отменена/);
});

test('an alert is skipped when the Rosa chat is not configured', async () => {
  assert.deepEqual(await sendBookingAlert('new', booking, null), { ok: false, reason: 'unconfigured' });
});

test('an alert posts the text to the configured chat', async () => {
  const calls = [];
  const result = await sendBookingAlert('paid', booking, { botToken: 'token', chatId: 'chat' }, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  });
  assert.equal(result.messageId, 7);
  assert.equal(calls[0].url, 'https://api.telegram.org/bottoken/sendMessage');
  assert.equal(calls[0].body.chat_id, 'chat');
  assert.match(calls[0].body.text, /Оплата подтверждена/);
});

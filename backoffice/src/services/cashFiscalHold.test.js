import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideFiscalSend,
  FISCAL_SEND_CLOSED,
  FISCAL_SEND_CLOSING,
  FISCAL_SEND_NO_SHIFT,
  isPureCashSale,
  fiscalShiftIsOpen,
  autoCashSendQuota,
  cashOfdReportLines,
  ofdSplitNote,
  pickHeldCashToSend,
  shouldEnqueueFiscalClose,
  shouldEnqueueFiscalOpen,
  shouldHoldCashReceipt,
  unsentCashNote,
  zButtonDecision,
} from './cashFiscalHold.js';

test('only a fully cash sale is held, and only when the switch is on', () => {
  const cash = [{ method: 'cash', amount: 100 }];
  assert.equal(shouldHoldCashReceipt({ holdCash: true, payments: cash, total: 100 }), true);
  assert.equal(shouldHoldCashReceipt({ holdCash: false, payments: cash, total: 100 }), false);
  assert.equal(
    shouldHoldCashReceipt({
      holdCash: true,
      payments: [
        { method: 'cash', amount: 50 },
        { method: 'card', amount: 50 },
      ],
      total: 100,
    }),
    false
  );
  assert.equal(
    shouldHoldCashReceipt({ holdCash: true, payments: [{ method: 'card', amount: 100 }], total: 100 }),
    false
  );
  assert.equal(
    shouldHoldCashReceipt({ holdCash: true, payments: [{ method: 'qr', amount: 100 }], total: 100 }),
    false
  );
  assert.equal(shouldHoldCashReceipt({ holdCash: true, payments: cash, total: 0 }), false);
  assert.equal(isPureCashSale([]), false);
});

test('a held receipt can be sent only into a fiscal shift that is still open', () => {
  assert.equal(decideFiscalSend({ opens: [], closes: [] }).error, FISCAL_SEND_NO_SHIFT);
  assert.equal(
    decideFiscalSend({
      opens: [{ id: 1, status: 'done' }],
      closes: [{ id: 2, status: 'done' }],
    }).error,
    FISCAL_SEND_CLOSED
  );
  assert.equal(
    decideFiscalSend({
      opens: [{ id: 1, status: 'done' }],
      closes: [{ id: 2, status: 'pending' }],
    }).error,
    FISCAL_SEND_CLOSING
  );
  assert.equal(
    decideFiscalSend({
      opens: [{ id: 1, status: 'done' }],
      closes: [{ id: 2, status: 'deferred' }],
    }).ok,
    true
  );
  assert.equal(
    decideFiscalSend({
      opens: [
        { id: 1, status: 'done' },
        { id: 4, status: 'done' },
      ],
      closes: [{ id: 2, status: 'done' }],
    }).ok,
    true
  );
});

test('unsent cash is marked, and the Z goes out on every close', () => {
  assert.equal(unsentCashNote(0, 0), null);
  const note = unsentCashNote(2, 1500);
  assert.match(note, /1500\.00/);
  assert.match(note, /не в ОФД/);
  assert.match(note, /уже учтена/);
  assert.equal(ofdSplitNote({ cashCount: 10, sentCount: 10, unsentCount: 0, unsentTotal: 0 }), null);
  const split = ofdSplitNote({ cashCount: 10, sentCount: 2, unsentCount: 8, unsentTotal: 6400 });
  assert.match(split, /Наличных чеков: 10/);
  assert.match(split, /В ОФД: 2/);
  assert.match(split, /Не в ОФД: 8 на 6400\.00/);
  assert.match(split, /В Z только отправленные/);
  assert.equal(shouldEnqueueFiscalClose(), true);
  assert.equal(shouldEnqueueFiscalClose(true), true);
  assert.equal(fiscalShiftIsOpen([{ id: 1, status: 'done' }], []), true);
  assert.equal(
    fiscalShiftIsOpen([{ id: 1, status: 'done' }], [{ id: 2, status: 'done' }]),
    false
  );
  assert.equal(shouldEnqueueFiscalOpen({ holdCash: false, fiscalShiftOpen: true }), true);
  assert.equal(shouldEnqueueFiscalOpen({ holdCash: true, fiscalShiftOpen: true }), false);
  assert.equal(shouldEnqueueFiscalOpen({ holdCash: true, fiscalShiftOpen: false }), true);
});

test('auto cash quota sends the smallest held receipts and only after 10 checks and 3 cash ones', () => {
  assert.equal(autoCashSendQuota({ totalReceipts: 9, cashReceipts: 5 }), 0);
  assert.equal(autoCashSendQuota({ totalReceipts: 60, cashReceipts: 2 }), 0);
  assert.equal(autoCashSendQuota({ totalReceipts: 10, cashReceipts: 3 }), 1);
  assert.equal(autoCashSendQuota({ totalReceipts: 29, cashReceipts: 8 }), 1);
  assert.equal(autoCashSendQuota({ totalReceipts: 30, cashReceipts: 7 }), 2);
  assert.equal(autoCashSendQuota({ totalReceipts: 60, cashReceipts: 8 }), 3);
  assert.equal(autoCashSendQuota({ totalReceipts: 100, cashReceipts: 20 }), 5);
  assert.equal(autoCashSendQuota({ totalReceipts: 100, cashReceipts: 20, maxQuota: 3 }), 3);
  assert.equal(autoCashSendQuota({ totalReceipts: 60, cashReceipts: 8, maxQuota: 0 }), 0);

  const receipts = [
    { id: 5, total: 500, fiscalStatus: 'held' },
    { id: 2, total: 100, fiscalStatus: 'held' },
    { id: 9, total: 100, fiscalStatus: 'held' },
    { id: 7, total: 900, fiscalStatus: 'held' },
    { id: 3, total: 50, fiscalStatus: 'done' },
    { id: 4, total: 40, fiscalStatus: 'pending' },
  ];
  assert.deepEqual(pickHeldCashToSend(receipts, 2), []);
  assert.deepEqual(pickHeldCashToSend(receipts, 4), [2, 9]);
  assert.deepEqual(pickHeldCashToSend(receipts, 1), []);
});

test('the close report lists cash that entered this Z and cash still outside OFD', () => {
  const lines = cashOfdReportLines({
    totalReceipts: 80,
    quota: 2,
    receipts: [
      { id: 11, total: 240, fiscalStatus: 'pending' },
      { id: 10, total: 180, fiscalStatus: 'done' },
      { id: 30, total: 1500, fiscalStatus: 'error', lastError: 'ОФД не ответил' },
      { id: 20, total: 900, fiscalStatus: 'held', closedAt: '2026-10-28T19:03:00.000Z' },
    ],
  }).join('\n');
  assert.match(lines, /Чеков за смену: 80/);
  assert.match(lines, /Наличных чеков: 4 на 2820\.00/);
  assert.match(lines, /Квота автоотправки: 2 самых мелких/);
  assert.match(lines, /В этот Z: 2 на 420\.00/);
  assert.match(lines, /№10 · 180\.00 ₽ · уже в кассе/);
  assert.match(lines, /№11 · 240\.00 ₽ · в очереди на кассу/);
  assert.match(lines, /Не в ОФД: 2 на 2400\.00/);
  assert.match(lines, /№20 · 900\.00 ₽ · 29\.10, 00:03/);
  assert.match(lines, /№30 · 1500\.00 ₽ · касса не приняла · ОФД не ответил/);
  assert.match(lines, /следующую открытую смену/);

  const small = cashOfdReportLines({
    totalReceipts: 6,
    receipts: [
      { id: 2, total: 3450, fiscalStatus: 'held' },
      { id: 1, total: 750, fiscalStatus: 'held' },
    ],
  }).join('\n');
  assert.match(small, /Квота автоотправки: 0, чеков меньше 10/);
  assert.match(small, /В этот Z: 0 на 0\.00/);
  assert.match(small, /Не в ОФД: 2 на 4200\.00/);
  assert.ok(small.indexOf('№1') < small.indexOf('№2'));
});

test('the backoffice Z button does not fire while the shift is open or the next fiscal shift is already open', () => {
  assert.equal(zButtonDecision({ shiftStatus: 'open', closeStatus: null, newerOpenDone: false }).ok, false);
  assert.equal(
    zButtonDecision({ shiftStatus: 'closed', closeStatus: 'error', newerOpenDone: true }).ok,
    false
  );
  assert.equal(
    zButtonDecision({ shiftStatus: 'closed', closeStatus: 'done', newerOpenDone: false }).done,
    true
  );
  assert.equal(
    zButtonDecision({ shiftStatus: 'closed', closeStatus: 'error', newerOpenDone: false }).action,
    'retry'
  );
  assert.equal(
    zButtonDecision({ shiftStatus: 'closed', closeStatus: null, newerOpenDone: false }).action,
    'enqueue'
  );
});

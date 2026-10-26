import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideFiscalSend,
  FISCAL_SEND_CLOSED,
  FISCAL_SEND_CLOSING,
  FISCAL_SEND_NO_SHIFT,
  isPureCashSale,
  planDeferredCloses,
  shouldHoldCashReceipt,
  shouldKeepFiscalShiftForHeldCash,
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

test('the next fiscal open is skipped only while the held shift is still inside 22 hours', () => {
  assert.equal(
    shouldKeepFiscalShiftForHeldCash({ hasDeferredClose: true, fiscalOpenAgeHours: 12 }),
    true
  );
  assert.equal(
    shouldKeepFiscalShiftForHeldCash({ hasDeferredClose: true, fiscalOpenAgeHours: 22 }),
    false
  );
  assert.equal(
    shouldKeepFiscalShiftForHeldCash({ hasDeferredClose: false, fiscalOpenAgeHours: 1 }),
    false
  );
  assert.equal(
    shouldKeepFiscalShiftForHeldCash({ hasDeferredClose: true, fiscalOpenAgeHours: null }),
    false
  );
});

test('deferred Z stays while a later shift is open and prints only after the cash queue is empty', () => {
  const waiting = planDeferredCloses({
    deferredCloses: [{ id: 10, shiftId: 1 }],
    shifts: [
      { id: 1, status: 'closed' },
      { id: 2, status: 'open' },
    ],
    blockingHeld: 2,
  });
  assert.deepEqual(waiting, { cancel: [], release: null });

  const ready = planDeferredCloses({
    deferredCloses: [{ id: 10, shiftId: 1 }],
    shifts: [{ id: 1, status: 'closed' }],
    blockingHeld: 0,
  });
  assert.deepEqual(ready, { cancel: [], release: 10 });

  const continued = planDeferredCloses({
    deferredCloses: [
      { id: 10, shiftId: 1 },
      { id: 20, shiftId: 2 },
    ],
    shifts: [
      { id: 1, status: 'closed' },
      { id: 2, status: 'closed' },
    ],
    blockingHeld: 0,
  });
  assert.deepEqual(continued, { cancel: [10], release: 20 });
});

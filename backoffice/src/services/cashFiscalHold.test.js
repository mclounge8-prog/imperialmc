import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideFiscalSend,
  FISCAL_SEND_CLOSED,
  FISCAL_SEND_CLOSING,
  FISCAL_SEND_NO_SHIFT,
  isPureCashSale,
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

test('unsent cash is named separately and does not replace the cash total', () => {
  assert.equal(unsentCashNote(0, 0), null);
  const note = unsentCashNote(2, 1500);
  assert.match(note, /1500\.00/);
  assert.match(note, /уже учтена/);
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

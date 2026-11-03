import assert from 'node:assert/strict';
import test from 'node:test';
import { FN_CASH_DRAWER_CAP, readFnCashSum } from './fnCashSum.ts';

test('reads the fiscal drawer sum from shift totals', () => {
  assert.equal(readFnCashSum({ shiftTotals: { cashDrawer: { sum: 1500.5 } } }), 1500.5);
  assert.equal(readFnCashSum({ ShiftTotals: { CashDrawer: { Sum: 80 } } }), 80);
  assert.equal(readFnCashSum({}), null);
  assert.equal(readFnCashSum({ shiftTotals: { cashDrawer: { sum: -1 } } }), null);
  const glitch = readFnCashSum({ shiftTotals: { cashDrawer: { sum: 962365 } } });
  assert.equal(glitch, 962365);
  assert.ok(glitch != null && glitch > FN_CASH_DRAWER_CAP);
});

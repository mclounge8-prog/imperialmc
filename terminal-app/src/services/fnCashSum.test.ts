import assert from 'node:assert/strict';
import test from 'node:test';
import { readFnCashSum } from './fnCashSum.ts';

test('reads the fiscal drawer sum from shift totals', () => {
  assert.equal(readFnCashSum({ shiftTotals: { cashDrawer: { sum: 1500.5 } } }), 1500.5);
  assert.equal(readFnCashSum({ ShiftTotals: { CashDrawer: { Sum: 80 } } }), 80);
  assert.equal(readFnCashSum({}), null);
  assert.equal(readFnCashSum({ shiftTotals: { cashDrawer: { sum: -1 } } }), null);
});

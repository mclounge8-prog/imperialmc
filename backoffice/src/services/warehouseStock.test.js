import test from 'node:test';
import assert from 'node:assert/strict';
import { stockDeltasForItems } from './warehouseStock.js';

test('returns warehouse qty times portions', () => {
  const deltas = stockDeltasForItems([
    {
      qty: 4,
      modifiers: [
        { warehouse_item_id: 1, qty: '21.000' },
        { warehouse_item_id: 2, qty: 55 },
        { name: 'без склада', qty: 1 },
      ],
    },
  ]);
  assert.deepEqual(deltas, [
    { warehouseItemId: 1, deltaQty: 84 },
    { warehouseItemId: 2, deltaQty: 220 },
  ]);
});

test('sums the same ingredient across lines', () => {
  const deltas = stockDeltasForItems([
    { qty: 1, modifiers: [{ warehouseItemId: 5, qty: 50 }] },
    { qty: 2, modifiers: [{ warehouse_item_id: 5, qty: 50 }] },
  ]);
  assert.deepEqual(deltas, [{ warehouseItemId: 5, deltaQty: 150 }]);
});

test('skips empty lines and zero consumption', () => {
  assert.deepEqual(
    stockDeltasForItems([
      { qty: 0, modifiers: [{ warehouse_item_id: 1, qty: 21 }] },
      { qty: 1, modifiers: [{ warehouse_item_id: 1, qty: 0 }] },
      { qty: 1, modifiers: [] },
    ]),
    []
  );
});

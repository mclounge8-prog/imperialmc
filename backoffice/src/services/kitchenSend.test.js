import assert from 'node:assert/strict';
import test from 'node:test';
import { kitchenItemIdsFromBody, pickKitchenItems } from './kitchenSend.js';

const items = [
  { id: 1, qty: 2, sentQty: 0 },
  { id: 2, qty: 1, sentQty: 1 },
  { id: 3, qty: 3, sentQty: 1 },
];

test('without a selection every unsent line goes to the kitchen', () => {
  assert.deepEqual(
    pickKitchenItems(items, null).map((item) => item.id),
    [1, 3]
  );
  assert.equal(kitchenItemIdsFromBody({}), null);
  assert.equal(kitchenItemIdsFromBody(null), null);
});

test('a selection sends only the checked lines that are still unsent', () => {
  assert.deepEqual(
    pickKitchenItems(items, [3, 2, 9]).map((item) => item.id),
    [3]
  );
  assert.deepEqual(pickKitchenItems(items, []), []);
  assert.deepEqual(kitchenItemIdsFromBody({ itemIds: [3] }), [3]);
});

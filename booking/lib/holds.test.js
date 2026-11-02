import assert from 'node:assert/strict';
import test from 'node:test';
import { canBook, rangesOverlap, seatsHeld } from './holds.js';

test('evening and after midnight share one night', () => {
  assert.equal(rangesOverlap('23:00', '00:30', 120), true);
  assert.equal(rangesOverlap('20:00', '21:00', 120), true);
  assert.equal(rangesOverlap('20:00', '22:00', 120), false);
  assert.equal(rangesOverlap('16:00', '01:00', 120), false);
});

test('held seats are only the overlapping party on that table', () => {
  const bookings = [
    { tableId: 11, date: '2026-11-02', time: '20:00', guests: 2, status: 'new' },
    { tableId: 11, date: '2026-11-02', time: '23:00', guests: 4, status: 'reserved' },
    { tableId: 11, date: '2026-11-02', time: '20:30', guests: 9, status: 'cancelled' },
    { tableId: 27, date: '2026-11-02', time: '20:00', guests: 6, status: 'paid' },
  ];
  assert.equal(seatsHeld(bookings, 11, '2026-11-02', '21:00', 120), 2);
  assert.equal(seatsHeld(bookings, 11, '2026-11-02', '23:30', 120), 4);
});

test('a table shows free seats and refuses a party that does not fit', () => {
  assert.deepEqual(canBook({ seats: 4, held: 2, guests: 2, bookable: true }), {
    ok: true,
    free: 2,
    reason: null,
  });
  assert.equal(canBook({ seats: 4, held: 2, guests: 3, bookable: true }).reason, 'full');
  assert.equal(canBook({ seats: 4, held: 0, guests: 5, bookable: true }).reason, 'too_big');
  assert.equal(canBook({ seats: 10, held: 0, guests: 4, bookable: false }).reason, 'closed');
});

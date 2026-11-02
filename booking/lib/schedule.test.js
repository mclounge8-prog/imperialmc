import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimePool, dateAllowed, sortTimes } from './schedule.js';

test('a pool can cross midnight and land on the minute', () => {
  assert.deepEqual(buildTimePool({ from: '23:00', to: '01:00', step: 30 }).times, [
    '23:00', '23:30', '00:00', '00:30', '01:00',
  ]);
  assert.deepEqual(buildTimePool({ from: '16:10', to: '16:40', step: 15 }).times, [
    '16:10', '16:25', '16:40',
  ]);
});

test('a pool rejects a step that is too fine or a bad clock', () => {
  assert.equal(buildTimePool({ from: '16:00', to: '18:00', step: 4 }).reason, 'step');
  assert.equal(buildTimePool({ from: '25:00', to: '18:00', step: 30 }).reason, 'time');
});

test('times after midnight sort to the end of the night', () => {
  assert.deepEqual(sortTimes(['01:15', '20:00', '20:00', '00:45', 'nope']), [
    '20:00', '00:45', '01:15',
  ]);
});

test('an empty date bound stays open and a range is inclusive', () => {
  assert.equal(dateAllowed('2026-11-14', '', ''), true);
  assert.equal(dateAllowed('2026-11-14', '2026-11-14', '2026-11-14'), true);
  assert.equal(dateAllowed('2026-11-13', '2026-11-14', ''), false);
  assert.equal(dateAllowed('2026-11-15', '', '2026-11-14'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { KITCHEN_LIMIT_MS, KITCHEN_WARN_MS, kitchenFinishedAt, kitchenTiming, moreUrgent } from './timing.ts';
import { chooseUpdatePlan } from '../services/updatePlan.ts';

const base = Date.parse('2026-10-16T12:00:00.000Z');

test('timer stays calm before 15 minutes', () => {
  const at = kitchenTiming(base, base + KITCHEN_WARN_MS - 1000, true);
  assert.equal(at.state, 'ok');
  assert.match(at.label, /^осталось /);
});

test('timer warns from 15 minutes and turns red at 20', () => {
  const warn = kitchenTiming(base, base + KITCHEN_WARN_MS, true);
  assert.equal(warn.state, 'warn');
  assert.match(warn.label, /время выходит/);
  const late = kitchenTiming(base, base + KITCHEN_LIMIT_MS, true);
  assert.equal(late.state, 'late');
  assert.match(late.label, /сверх 20 мин/);
});

test('finished ticket freezes at the ready moment', () => {
  const readyAt = base + 12 * 60 * 1000;
  const done = kitchenTiming(base, readyAt, false, readyAt);
  const later = kitchenTiming(base, readyAt + 40 * 60 * 1000, false, readyAt);
  assert.equal(done.state, 'done');
  assert.equal(done.label, 'готов за 12:00');
  assert.equal(later.label, done.label);
  assert.equal(kitchenFinishedAt(null, [new Date(readyAt).toISOString()]), readyAt);
});

test('table takes the most urgent unfinished ticket', () => {
  assert.equal(moreUrgent('ok', 'warn'), 'warn');
  assert.equal(moreUrgent('late', 'warn'), 'late');
  assert.equal(moreUrgent(undefined, 'ok'), 'ok');
});

const remote = {
  apk: {
    versionCode: 6,
    versionName: '1.0.5',
    url: 'https://example/terminal.apk',
    mandatory: false,
    notes: 'зал',
    sha256: null,
  },
  js: {
    version: 39,
    minApkVersionCode: 6,
    url: 'https://example/hall.js.zip',
    mandatory: true,
    notes: 'зал js',
    sha256: null,
  },
  kiosk: {
    versionCode: 14,
    versionName: '1.13.0',
    url: 'https://example/kiosk.apk',
    notes: '',
    sha256: null,
  },
  kitchen: {
    versionCode: 3,
    versionName: '1.2.0',
    url: 'https://example/kitchen.apk',
    mandatory: true,
    notes: 'кухня',
    sha256: null,
  },
  kitchenJs: {
    version: 1,
    minApkVersionCode: 3,
    url: 'https://example/kitchen.js.zip',
    mandatory: true,
    notes: 'кухня js',
    sha256: null,
  },
};

test('kitchen does not install the hall bundle', () => {
  const plan = chooseUpdatePlan('kitchen', { versionCode: 3, versionName: '1.2.0', jsOtaVersion: 0 }, {
    ...remote,
    kitchenJs: { ...remote.kitchenJs, version: 0, url: null },
  });
  assert.equal(plan.kind, 'none');
});

test('kitchen apk update is mandatory and ignores the hall apk', () => {
  const plan = chooseUpdatePlan('kitchen', { versionCode: 2, versionName: '1.1.0', jsOtaVersion: 0 }, remote);
  assert.equal(plan.kind, 'apk');
  if (plan.kind !== 'apk') return;
  assert.equal(plan.remote.versionCode, 3);
  assert.equal(plan.remote.mandatory, true);
  assert.match(plan.remote.url || '', /kitchen\.apk/);
});

test('kitchen interface update uses only kitchenJs', () => {
  const plan = chooseUpdatePlan('kitchen', { versionCode: 3, versionName: '1.2.0', jsOtaVersion: 0 }, remote);
  assert.equal(plan.kind, 'js');
  if (plan.kind !== 'js') return;
  assert.equal(plan.remote.version, 1);
  assert.match(plan.remote.url || '', /kitchen\.js/);
});

test('old kitchen apk cannot take a newer interface bundle', () => {
  const plan = chooseUpdatePlan('kitchen', { versionCode: 2, versionName: '1.1.0', jsOtaVersion: 0 }, {
    ...remote,
    kitchen: { ...remote.kitchen, versionCode: 2 },
  });
  assert.equal(plan.kind, 'none');
});

test('hall still updates from its own channel', () => {
  const plan = chooseUpdatePlan('staff', { versionCode: 6, versionName: '1.0.5', jsOtaVersion: 38 }, remote);
  assert.equal(plan.kind, 'js');
  if (plan.kind !== 'js') return;
  assert.equal(plan.remote.version, 39);
});

test('kiosk stays on its apk and can be postponed', () => {
  const plan = chooseUpdatePlan('kiosk', { versionCode: 13, versionName: '1.12.0', jsOtaVersion: 0 }, remote);
  assert.equal(plan.kind, 'apk');
  if (plan.kind !== 'apk') return;
  assert.equal(plan.remote.versionCode, 14);
  assert.equal(plan.remote.mandatory, false);
});

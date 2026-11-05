import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyFloorSync, cleanFloorItems } from './floorSync.js';

test('the office stays off the booking hall and VIP keeps its public name', () => {
  const tables = cleanFloorItems([
    { id: 18, zone: 'Офис', zoneOrder: 2, name: 'Начальство', seats: 10, x: 40, y: 40, w: 160, h: 120 },
    { id: 27, zone: 'VIP Комната', zoneOrder: 3, name: 'Стол 1', seats: 10, x: 40, y: 40, w: 160, h: 120 },
  ], { seatsMin: 1 });
  assert.deepEqual(tables, [
    { id: 27, zone: 'VIP', zoneOrder: 3, name: 'Стол 1', seats: 10, x: 40, y: 40, w: 160, h: 120 },
  ]);
});

test('a table off the grid is rejected', () => {
  assert.equal(cleanFloorItems([
    { id: 11, zone: 'Основной зал', name: 'Стол 1', seats: 4, x: 10, y: 0, w: 120, h: 80 },
  ], { seatsMin: 1 }), null);
});

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tables (
      id INTEGER PRIMARY KEY,
      zone TEXT NOT NULL,
      zone_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      seats INTEGER NOT NULL,
      bookable INTEGER NOT NULL DEFAULT 1,
      pos_x INTEGER NOT NULL,
      pos_y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      bounds_w INTEGER NOT NULL,
      bounds_h INTEGER NOT NULL,
      seat_price INTEGER NOT NULL DEFAULT 0,
      zone_open INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY,
      table_id INTEGER NOT NULL
    );
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY,
      zone TEXT NOT NULL,
      zone_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      seats INTEGER NOT NULL,
      pos_x INTEGER NOT NULL,
      pos_y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO tables (id, zone, zone_order, name, seats, bookable, pos_x, pos_y, width, height, bounds_w, bounds_h, seat_price, zone_open)
     VALUES (11, 'Основной зал', 0, 'Стол 1', 6, 1, 0, 0, 80, 80, 800, 480, 800, 1)`
  ).run();
  return db;
}

test('a hall sync moves a table and keeps its booking price', () => {
  const db = memoryDb();
  applyFloorSync(db, {
    tables: [
      { id: 11, zone: 'Основной зал', zoneOrder: 0, name: 'Стол 1', seats: 4, x: 600, y: 0, w: 120, h: 80 },
      { id: 53, zone: 'Основной зал', zoneOrder: 0, name: 'Стол 16', seats: 4, x: 280, y: 80, w: 80, h: 80 },
    ],
    blocks: [
      { id: 2, zone: 'Основной зал', zoneOrder: 0, name: 'Сцена', seats: 0, x: 40, y: 0, w: 320, h: 80 },
    ],
  });
  const kept = db.prepare('SELECT seats, seat_price, pos_x, pos_y, width, height FROM tables WHERE id = 11').get();
  assert.deepEqual({ ...kept }, { seats: 6, seat_price: 800, pos_x: 600, pos_y: 0, width: 120, height: 80 });
  const added = db.prepare('SELECT name, seats, seat_price, zone_open FROM tables WHERE id = 53').get();
  assert.deepEqual({ ...added }, { name: 'Стол 16', seats: 4, seat_price: 0, zone_open: 1 });
  assert.equal(db.prepare('SELECT name FROM blocks WHERE id = 2').get().name, 'Сцена');
});

test('a table deleted in the hall leaves the booking plan', () => {
  const db = memoryDb();
  db.prepare(
    `INSERT INTO tables (id, zone, zone_order, name, seats, bookable, pos_x, pos_y, width, height, bounds_w, bounds_h, seat_price, zone_open)
     VALUES (99, 'Основной зал', 0, 'Стол 99', 4, 1, 40, 40, 80, 80, 800, 480, 0, 1)`
  ).run();
  db.prepare('INSERT INTO bookings (table_id) VALUES (99)').run();
  applyFloorSync(db, {
    tables: [
      { id: 11, zone: 'Основной зал', zoneOrder: 0, name: 'Стол 1', seats: 4, x: 0, y: 0, w: 80, h: 80 },
    ],
  });
  const kept = db.prepare('SELECT on_plan, bookable FROM tables WHERE id = 99').get();
  assert.equal(kept.on_plan, 0);
  assert.equal(kept.bookable, 0);
  db.prepare(
    `INSERT INTO tables (id, zone, zone_order, name, seats, bookable, pos_x, pos_y, width, height, bounds_w, bounds_h, seat_price, zone_open, on_plan)
     VALUES (12, 'Основной зал', 0, 'Стол 12', 4, 1, 80, 80, 80, 80, 800, 480, 0, 1, 1)`
  ).run();
  applyFloorSync(db, {
    tables: [
      { id: 11, zone: 'Основной зал', zoneOrder: 0, name: 'Стол 1', seats: 4, x: 0, y: 0, w: 80, h: 80 },
    ],
  });
  assert.equal(db.prepare('SELECT id FROM tables WHERE id = 12').get(), undefined);
});

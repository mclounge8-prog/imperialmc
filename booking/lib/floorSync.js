const PLAN_W = 800;
const PLAN_H = 480;

export const ZONE_ALIAS = new Map([['VIP Комната', 'VIP']]);
export const HIDDEN_ZONES = new Set(['Начальство', 'Офис']);

function ensureOnPlan(db) {
  const names = db.prepare('PRAGMA table_info(tables)').all().map((column) => column.name);
  if (!names.includes('on_plan')) {
    db.exec('ALTER TABLE tables ADD COLUMN on_plan INTEGER NOT NULL DEFAULT 1');
  }
}

function dropTablesMissingFromHall(db, tables) {
  const present = new Set(tables.map((table) => table.id));
  const booked = new Set(
    db.prepare('SELECT DISTINCT table_id AS id FROM bookings').all().map((row) => row.id)
  );
  const hide = db.prepare('UPDATE tables SET on_plan = 0, bookable = 0 WHERE id = ?');
  const remove = db.prepare('DELETE FROM tables WHERE id = ?');
  for (const row of db.prepare('SELECT id FROM tables').all()) {
    if (present.has(row.id)) continue;
    if (booked.has(row.id)) hide.run(row.id);
    else remove.run(row.id);
  }
}

function onGrid(value) {
  return Number.isInteger(value) && value >= 0 && value % 40 === 0;
}

/** Столы и прямоугольники с расстановки Розы. Скрытые зоны пропускаются. */
export function cleanFloorItems(list, { seatsMin }) {
  if (!Array.isArray(list) || list.length > 200) return null;
  const items = [];
  for (const item of list) {
    const id = Number(item?.id);
    const seats = Number(item?.seats);
    const x = Number(item?.x);
    const y = Number(item?.y);
    const w = Number(item?.w);
    const h = Number(item?.h);
    const zone = String(item?.zone || '').trim().slice(0, 100);
    const name = String(item?.name || '').trim().slice(0, 50);
    const zoneOrder = Number(item?.zoneOrder) || 0;
    if (!Number.isInteger(id) || id < 1 || id > 1_000_000_000) return null;
    if (!zone || HIDDEN_ZONES.has(zone)) continue;
    if (!Number.isInteger(seats) || seats < seatsMin || seats > 99) return null;
    if (![x, y, w, h].every(onGrid)) return null;
    if (w < 40 || h < 40 || x + w > PLAN_W || y + h > PLAN_H) return null;
    items.push({
      id,
      zone: ZONE_ALIAS.get(zone) || zone,
      zoneOrder,
      name,
      seats,
      x,
      y,
      w,
      h,
    });
  }
  return items;
}

/**
 * Геометрия и названия приходят из зала Розы.
 * Цена места, число мест к брони, открытость стола и зала остаются как в заявках.
 */
export function applyFloorSync(db, { tables = null, blocks = null } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (blocks) {
      db.prepare('DELETE FROM blocks').run();
      const insertBlock = db.prepare(
        `INSERT INTO blocks (id, zone, zone_order, name, seats, pos_x, pos_y, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const block of blocks) {
        insertBlock.run(block.id, block.zone, block.zoneOrder, block.name, block.seats, block.x, block.y, block.w, block.h);
      }
    }
    if (tables) {
      ensureOnPlan(db);
      const update = db.prepare(
        `UPDATE tables
         SET zone = ?, zone_order = ?, name = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, on_plan = 1
         WHERE id = ?`
      );
      const insert = db.prepare(
        `INSERT INTO tables
           (id, zone, zone_order, name, seats, bookable, pos_x, pos_y, width, height, bounds_w, bounds_h, seat_price, zone_open, on_plan)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
      );
      const zoneOpen = db.prepare('SELECT zone_open FROM tables WHERE zone = ? LIMIT 1');
      for (const table of tables) {
        const current = db.prepare('SELECT id FROM tables WHERE id = ?').get(table.id);
        if (current) {
          update.run(table.zone, table.zoneOrder, table.name, table.x, table.y, table.w, table.h, table.id);
          continue;
        }
        const sibling = zoneOpen.get(table.zone);
        insert.run(
          table.id,
          table.zone,
          table.zoneOrder,
          table.name,
          table.seats,
          table.x,
          table.y,
          table.w,
          table.h,
          PLAN_W,
          PLAN_H,
          sibling ? sibling.zone_open : 1
        );
      }
      dropTablesMissingFromHall(db, tables);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    throw err;
  }
}

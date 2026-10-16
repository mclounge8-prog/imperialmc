import { pool } from '../db.js';

const STATEMENTS = [
  `ALTER TABLE devices ADD COLUMN IF NOT EXISTS kitchen_enabled BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS kitchen_tickets (
     id SERIAL PRIMARY KEY,
     venue_id INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
     shift_id INT REFERENCES shifts(id) ON DELETE SET NULL,
     order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
     guest_id INT REFERENCES order_guests(id) ON DELETE SET NULL,
     table_id INT REFERENCES tables(id) ON DELETE SET NULL,
     status VARCHAR(16) NOT NULL DEFAULT 'new',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     ready_at TIMESTAMPTZ,
     created_by INT REFERENCES staff(id) ON DELETE SET NULL,
     created_by_name VARCHAR(100)
   )`,
  `CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
     id SERIAL PRIMARY KEY,
     ticket_id INT NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
     order_item_id INT REFERENCES order_items(id) ON DELETE SET NULL,
     name VARCHAR(200) NOT NULL,
     qty INT NOT NULL,
     modifiers JSONB NOT NULL DEFAULT '[]'::jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_venue_status ON kitchen_tickets (venue_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_order ON kitchen_tickets (order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kitchen_ticket_items_ticket ON kitchen_ticket_items (ticket_id)`,
];

export async function ensureKitchenSchema() {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
}

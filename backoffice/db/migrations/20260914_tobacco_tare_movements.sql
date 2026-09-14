-- Приход/списание тары: журнал движений (идемпотентно).
CREATE TABLE IF NOT EXISTS tobacco_tare_movements (
  id               SERIAL PRIMARY KEY,
  venue_id         INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  shift_id         INT REFERENCES shifts(id) ON DELETE SET NULL,
  type             VARCHAR(20) NOT NULL CHECK (type IN ('receipt', 'writeoff')),
  staff_id         INT REFERENCES staff(id) ON DELETE SET NULL,
  staff_name       VARCHAR(100),
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tobacco_tare_movement_lines (
  id               SERIAL PRIMARY KEY,
  movement_id      INT NOT NULL REFERENCES tobacco_tare_movements(id) ON DELETE CASCADE,
  tobacco_tare_id  INT NOT NULL REFERENCES tobacco_tares(id) ON DELETE RESTRICT,
  tare_label       VARCHAR(150) NOT NULL,
  qty              INT NOT NULL CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_tobacco_tare_movements_venue
  ON tobacco_tare_movements(venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tobacco_tare_movement_lines_movement
  ON tobacco_tare_movement_lines(movement_id);

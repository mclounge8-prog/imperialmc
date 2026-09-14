-- Списание остатка табака (меласса) в граммах со склада точки.
CREATE TABLE IF NOT EXISTS tobacco_stock_writeoffs (
  id               SERIAL PRIMARY KEY,
  venue_id         INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  shift_id         INT REFERENCES shifts(id) ON DELETE SET NULL,
  amount_g         NUMERIC(12,3) NOT NULL CHECK (amount_g > 0),
  stock_before_g   NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_after_g    NUMERIC(12,3) NOT NULL DEFAULT 0,
  staff_id         INT REFERENCES staff(id) ON DELETE SET NULL,
  staff_name       VARCHAR(100),
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tobacco_stock_writeoff_lines (
  id                 SERIAL PRIMARY KEY,
  writeoff_id        INT NOT NULL REFERENCES tobacco_stock_writeoffs(id) ON DELETE CASCADE,
  warehouse_item_id  INT NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
  item_name          VARCHAR(200) NOT NULL,
  amount_g           NUMERIC(12,3) NOT NULL CHECK (amount_g > 0)
);

CREATE INDEX IF NOT EXISTS idx_tobacco_stock_writeoffs_venue
  ON tobacco_stock_writeoffs(venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tobacco_stock_writeoff_lines_writeoff
  ON tobacco_stock_writeoff_lines(writeoff_id);

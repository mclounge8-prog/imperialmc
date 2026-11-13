import { pool } from '../db.js';

/** Дополнительные функции заведения. Новая доработка — ещё одна строка здесь. */
export const VENUE_FEATURES = [
  {
    key: 'served_marks',
    title: 'Отметка «отдано» в чеке',
    hint: 'На планшете слева от названия позиции появляется маленький чекбокс. Отмеченная позиция слегка приглушается — её уже отдали. Повторное нажатие снимает отметку.',
  },
];

const FEATURE_KEYS = new Set(VENUE_FEATURES.map((feature) => feature.key));

export function isKnownVenueFeature(key) {
  return FEATURE_KEYS.has(key);
}

export async function ensureVenueFeaturesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS venue_features (
       venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
       feature_key VARCHAR(64) NOT NULL,
       enabled     BOOLEAN NOT NULL DEFAULT false,
       PRIMARY KEY (venue_id, feature_key)
     )`
  );
  await pool.query(
    'ALTER TABLE order_items ADD COLUMN IF NOT EXISTS served BOOLEAN NOT NULL DEFAULT false'
  );
}

export async function isVenueFeatureEnabled(venueId, key) {
  if (!venueId || !isKnownVenueFeature(key)) return false;
  const { rows } = await pool.query(
    `SELECT enabled FROM venue_features
     WHERE venue_id = $1 AND feature_key = $2`,
    [venueId, key]
  );
  return !!rows[0]?.enabled;
}

export async function listVenueFeatures(venueId) {
  const { rows } = await pool.query(
    'SELECT feature_key, enabled FROM venue_features WHERE venue_id = $1',
    [venueId]
  );
  const enabled = new Map(rows.map((row) => [row.feature_key, !!row.enabled]));
  return VENUE_FEATURES.map((feature) => ({
    ...feature,
    enabled: enabled.get(feature.key) === true,
  }));
}

export async function setVenueFeature(venueId, key, enabled) {
  if (!isKnownVenueFeature(key)) return null;
  await pool.query(
    `INSERT INTO venue_features (venue_id, feature_key, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (venue_id, feature_key)
     DO UPDATE SET enabled = EXCLUDED.enabled`,
    [venueId, key, !!enabled]
  );
  return listVenueFeatures(venueId);
}

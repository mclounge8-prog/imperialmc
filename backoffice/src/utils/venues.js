import { pool } from '../db.js';

export async function fetchAllVenues() {
  const { rows } = await pool.query('SELECT id, name FROM venues ORDER BY name');
  return rows;
}

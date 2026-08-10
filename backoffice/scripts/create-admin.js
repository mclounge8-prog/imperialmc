import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const [, , username, password] = process.argv;

if (!username || !password) {
  console.log('Использование: npm run create-admin -- <username> <password>');
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 10);

await pool.query(
  `INSERT INTO admin_users (username, password_hash, role)
   VALUES ($1, $2, 'admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = $2`,
  [username, passwordHash]
);

console.log(`Администратор "${username}" создан/обновлён.`);
await pool.end();

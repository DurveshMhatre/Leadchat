import { pool } from './src/services/database.js';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  try {
    const sqlPath = path.resolve('../../infra/db/002_verification.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}
run();

import { pool } from './src/services/database.js';

async function run() {
  try {
    const res = await pool.query('SELECT * FROM users LIMIT 1;');
    console.log(res.rows);
  } catch (err) {
    console.error('DB Error:', err);
  } finally {
    process.exit(0);
  }
}
run();

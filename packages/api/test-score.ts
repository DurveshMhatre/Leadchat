import { config } from 'dotenv';
config();
import { pool } from './src/services/database.js';
import { recomputeAndSaveScore } from './src/services/scoreEngine.js';

async function run() {
  try {
    const res = await pool.query(`SELECT id FROM users WHERE firebase_uid = 'test-buyer-002'`);
    if (res.rows.length > 0) {
      const id = res.rows[0].id;
      console.log('Testing score engine for user', id);
      await recomputeAndSaveScore(id);
      console.log('Score computed successfully.');
    } else {
      console.log('User not found.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}
run();

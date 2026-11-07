/**
 * Test setup — runs before each test file.
 * Uses a real PostgreSQL database pointed at by TEST_DATABASE_URL.
 * Each test suite gets a clean slate via TRUNCATE.
 */
import { pool } from '../src/db/pool';

export async function cleanDatabase(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      audit_log,
      idempotency_keys,
      ledger_entries,
      transactions,
      accounts,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function closePool(): Promise<void> {
  await pool.end();
}

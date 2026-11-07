/**
 * Run all migrations in order.
 * Safe to run multiple times — uses IF NOT EXISTS / DO NOTHING guards.
 */
import { pool } from './pool';

const schema = `
-- ──────────────────────────────────────────────
-- EXTENSIONS
-- ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- ACCOUNTS
-- Every account belongs to a user.
-- currency is ISO 4217 (e.g. USD, EUR).
-- balance is stored in minor units (cents) as BIGINT to avoid float drift.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  currency    CHAR(3)     NOT NULL DEFAULT 'USD',
  balance     BIGINT      NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- ──────────────────────────────────────────────
-- TRANSACTIONS
-- One transaction = one logical money-movement event.
-- A transaction fans out into two or more ledger_entries (debit + credit).
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by      UUID        NOT NULL REFERENCES users(id),
  from_account_id   UUID        REFERENCES accounts(id),
  to_account_id     UUID        REFERENCES accounts(id),
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  currency          CHAR(3)     NOT NULL DEFAULT 'USD',
  description       TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed','failed','reversed')),
  idempotency_key   TEXT        UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  CONSTRAINT chk_diff_accounts CHECK (from_account_id IS DISTINCT FROM to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_from   ON transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to     ON transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_idem   ON transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transactions_initiator ON transactions(initiated_by);

-- ──────────────────────────────────────────────
-- LEDGER ENTRIES  (double-entry)
-- Every transfer produces:
--   debit  entry on the source account  (amount > 0, direction = 'debit')
--   credit entry on the dest account    (amount > 0, direction = 'credit')
-- The constraint at the application level enforces sum(debits) = sum(credits)
-- per transaction.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID        NOT NULL REFERENCES transactions(id),
  account_id      UUID        NOT NULL REFERENCES accounts(id),
  direction       TEXT        NOT NULL CHECK (direction IN ('debit','credit')),
  amount          BIGINT      NOT NULL CHECK (amount > 0),
  running_balance BIGINT      NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_txn     ON ledger_entries(transaction_id);

-- ──────────────────────────────────────────────
-- IDEMPOTENCY KEYS  (separate fast-lookup table)
-- Stores the final serialised response so we can replay it verbatim.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT        PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES users(id),
  request_path   TEXT        NOT NULL,
  response_status INT        NOT NULL,
  response_body  JSONB       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_idem_user ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);

-- ──────────────────────────────────────────────
-- AUDIT LOG  (append-only, HMAC-chained)
-- Each row signs the previous row's hash to form a tamper-evident chain.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL   PRIMARY KEY,
  event_type      TEXT        NOT NULL,
  actor_id        UUID        REFERENCES users(id),
  resource_type   TEXT,
  resource_id     UUID,
  payload         JSONB       NOT NULL DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  prev_hash       TEXT,
  row_hash        TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor    ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_event    ON audit_log(event_type, created_at DESC);

-- Prevent any UPDATE or DELETE on audit_log via a trigger
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: mutations are not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations…');
    await client.query(schema);
    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

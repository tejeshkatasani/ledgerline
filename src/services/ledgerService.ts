/**
 * Ledger service — the heart of LedgerLine.
 *
 * All money movement goes through transferFunds().
 * Guarantees:
 *  - Atomicity: entire transfer or nothing (SERIALIZABLE transaction).
 *  - Double-entry: every transfer produces exactly one debit + one credit
 *    ledger entry. Sum of debits always equals sum of credits.
 *  - Non-negative balances: enforced by DB CHECK constraint AND application
 *    check before decrement.
 *  - Idempotency: callers pass an idempotency_key; a second call with the
 *    same key returns the original transaction without re-executing.
 *  - Audit: every state change is written to the append-only audit_log
 *    inside the same database transaction.
 */
import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { writeAudit } from './auditService';
import { fromCents } from '../types';
import {
  InsufficientFundsError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../utils/errors';

export interface TransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: bigint; // in cents
  currency: string;
  description?: string;
  idempotencyKey?: string;
  initiatedBy: string; // user id
  ipAddress?: string;
  userAgent?: string;
}

export interface TransferResult {
  transactionId: string;
  status: string;
  fromBalance: string; // decimal string
  toBalance: string;
  replayed: boolean;
}

export async function transferFunds(
  params: TransferParams
): Promise<TransferResult> {
  const {
    fromAccountId,
    toAccountId,
    amount,
    currency,
    description,
    idempotencyKey,
    initiatedBy,
    ipAddress,
    userAgent,
  } = params;

  if (amount <= 0n) {
    throw new ValidationError('Transfer amount must be positive');
  }
  if (fromAccountId === toAccountId) {
    throw new ValidationError('Source and destination accounts must differ');
  }

  // ── Idempotency check (outside the serialisable txn for speed) ────────────
  if (idempotencyKey) {
    const existing = await pool.query<{
      id: string;
      status: string;
      from_account_id: string;
      to_account_id: string;
    }>(
      `SELECT id, status, from_account_id, to_account_id
         FROM transactions
        WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (existing.rows.length > 0) {
      const txn = existing.rows[0];
      // Verify the key is being reused for the same operation
      if (
        txn.from_account_id !== fromAccountId ||
        txn.to_account_id !== toAccountId
      ) {
        throw new ConflictError(
          'Idempotency key reused with different parameters'
        );
      }
      // Fetch current balances
      const [fromAcc, toAcc] = await Promise.all([
        pool.query<{ balance: string }>(
          'SELECT balance FROM accounts WHERE id=$1',
          [fromAccountId]
        ),
        pool.query<{ balance: string }>(
          'SELECT balance FROM accounts WHERE id=$1',
          [toAccountId]
        ),
      ]);
      await writeAudit({
        eventType: 'idempotency.replayed',
        actorId: initiatedBy,
        resourceType: 'transaction',
        resourceId: txn.id,
        payload: { idempotency_key: idempotencyKey },
        ipAddress,
        userAgent,
      });
      return {
        transactionId: txn.id,
        status: txn.status,
        fromBalance: fromCents(BigInt(fromAcc.rows[0].balance)),
        toBalance: fromCents(BigInt(toAcc.rows[0].balance)),
        replayed: true,
      };
    }
  }

  // ── Serialisable transaction ───────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // Lock accounts in a consistent order (lower UUID first) to prevent deadlocks
    const [lockFirst, lockSecond] =
      fromAccountId < toAccountId
        ? [fromAccountId, toAccountId]
        : [toAccountId, fromAccountId];

    await client.query(
      'SELECT id FROM accounts WHERE id IN ($1,$2) FOR UPDATE',
      [lockFirst, lockSecond]
    );

    // Fetch and validate source account
    const fromResult = await client.query<{
      id: string;
      user_id: string;
      balance: string;
      currency: string;
      is_active: boolean;
    }>(
      `SELECT id, user_id, balance, currency, is_active
         FROM accounts WHERE id = $1`,
      [fromAccountId]
    );
    if (fromResult.rows.length === 0) {
      throw new NotFoundError('Source account');
    }
    const fromAccount = fromResult.rows[0];
    if (!fromAccount.is_active) {
      throw new ForbiddenError('Source account is closed');
    }
    if (fromAccount.user_id !== initiatedBy) {
      throw new ForbiddenError(
        'You do not own the source account'
      );
    }
    if (fromAccount.currency !== currency) {
      throw new ValidationError(
        `Currency mismatch: account is ${fromAccount.currency}`
      );
    }

    // Fetch and validate destination account
    const toResult = await client.query<{
      id: string;
      balance: string;
      currency: string;
      is_active: boolean;
    }>(
      `SELECT id, balance, currency, is_active
         FROM accounts WHERE id = $1`,
      [toAccountId]
    );
    if (toResult.rows.length === 0) {
      throw new NotFoundError('Destination account');
    }
    const toAccount = toResult.rows[0];
    if (!toAccount.is_active) {
      throw new ForbiddenError('Destination account is closed');
    }
    if (toAccount.currency !== currency) {
      throw new ValidationError(
        `Currency mismatch: destination account is ${toAccount.currency}`
      );
    }

    const fromBalance = BigInt(fromAccount.balance);
    if (fromBalance < amount) {
      throw new InsufficientFundsError();
    }

    // ── Create transaction record ──────────────────────────────────────────
    const txnResult = await client.query<{ id: string }>(
      `INSERT INTO transactions
         (initiated_by, from_account_id, to_account_id,
          amount, currency, description, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
       RETURNING id`,
      [
        initiatedBy,
        fromAccountId,
        toAccountId,
        amount.toString(),
        currency,
        description ?? null,
        idempotencyKey ?? null,
      ]
    );
    const transactionId = txnResult.rows[0].id;

    // ── Debit source ──────────────────────────────────────────────────────
    const newFromBalance = fromBalance - amount;
    await client.query(
      `UPDATE accounts SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [newFromBalance.toString(), fromAccountId]
    );
    await client.query(
      `INSERT INTO ledger_entries
         (transaction_id, account_id, direction, amount, running_balance)
       VALUES ($1,$2,'debit',$3,$4)`,
      [
        transactionId,
        fromAccountId,
        amount.toString(),
        newFromBalance.toString(),
      ]
    );

    // ── Credit destination ────────────────────────────────────────────────
    const toBalance = BigInt(toAccount.balance);
    const newToBalance = toBalance + amount;
    await client.query(
      `UPDATE accounts SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [newToBalance.toString(), toAccountId]
    );
    await client.query(
      `INSERT INTO ledger_entries
         (transaction_id, account_id, direction, amount, running_balance)
       VALUES ($1,$2,'credit',$3,$4)`,
      [
        transactionId,
        toAccountId,
        amount.toString(),
        newToBalance.toString(),
      ]
    );

    // ── Complete transaction ───────────────────────────────────────────────
    await client.query(
      `UPDATE transactions
          SET status = 'completed', completed_at = NOW()
        WHERE id = $1`,
      [transactionId]
    );

    // ── Audit (inside same txn — if this fails the whole txn rolls back) ──
    await writeAudit({
      eventType: 'transfer.completed',
      actorId: initiatedBy,
      resourceType: 'transaction',
      resourceId: transactionId,
      payload: {
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: amount.toString(),
        currency,
        description,
        idempotency_key: idempotencyKey,
      },
      ipAddress,
      userAgent,
      client,
    });

    await client.query('COMMIT');

    return {
      transactionId,
      status: 'completed',
      fromBalance: fromCents(newFromBalance),
      toBalance: fromCents(newToBalance),
      replayed: false,
    };
  } catch (err) {
    await client.query('ROLLBACK');

    // Audit the failure (best-effort — outside the rolled-back txn)
    await writeAudit({
      eventType: 'transfer.failed',
      actorId: initiatedBy,
      resourceType: 'account',
      resourceId: fromAccountId,
      payload: {
        error: err instanceof Error ? err.message : String(err),
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: amount.toString(),
        idempotency_key: idempotencyKey,
      },
      ipAddress,
      userAgent,
    }).catch(() => {
      /* best-effort */
    });

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetch paginated ledger entries for an account.
 * Verifies the requesting user owns the account.
 */
export async function getAccountLedger(
  accountId: string,
  requestingUserId: string,
  limit = 50,
  offset = 0
): Promise<{
  entries: Array<{
    id: string;
    transaction_id: string;
    direction: string;
    amount: string;
    running_balance: string;
    created_at: Date;
  }>;
  total: number;
}> {
  // Ownership check
  const acc = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM accounts WHERE id=$1',
    [accountId]
  );
  if (acc.rows.length === 0) throw new NotFoundError('Account');
  if (acc.rows[0].user_id !== requestingUserId) {
    throw new ForbiddenError('You do not own this account');
  }

  const [entries, countResult] = await Promise.all([
    pool.query<{
      id: string;
      transaction_id: string;
      direction: string;
      amount: string;
      running_balance: string;
      created_at: Date;
    }>(
      `SELECT id, transaction_id, direction,
              amount, running_balance, created_at
         FROM ledger_entries
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM ledger_entries WHERE account_id=$1',
      [accountId]
    ),
  ]);

  return {
    entries: entries.rows.map((r) => ({
      ...r,
      amount: fromCents(BigInt(r.amount)),
      running_balance: fromCents(BigInt(r.running_balance)),
    })),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

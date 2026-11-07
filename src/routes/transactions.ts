import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { getAccountLedger } from '../services/ledgerService';
import { fromCents } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';

const router = Router();

// GET /transactions — list all transactions involving caller's accounts
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 100);
      const offset = parseInt((req.query.offset as string) ?? '0', 10);

      const { rows } = await pool.query(
        `SELECT t.id, t.from_account_id, t.to_account_id,
                t.amount, t.currency, t.description, t.status,
                t.idempotency_key, t.created_at, t.completed_at
           FROM transactions t
          WHERE t.initiated_by = $1
             OR t.from_account_id IN (SELECT id FROM accounts WHERE user_id=$1)
             OR t.to_account_id   IN (SELECT id FROM accounts WHERE user_id=$1)
          ORDER BY t.created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );

      res.json({
        success: true,
        data: rows.map((r) => ({
          ...r,
          amount: fromCents(BigInt(r.amount)),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /transactions/account/:accountId/ledger — must come before /:id
router.get(
  '/account/:accountId/ledger',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 100);
      const offset = parseInt((req.query.offset as string) ?? '0', 10);
      const result = await getAccountLedger(
        req.params.accountId,
        req.user.id,
        limit,
        offset
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /transactions/:id — get a single transaction (must be involved)
router.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT t.id, t.initiated_by, t.from_account_id, t.to_account_id,
                t.amount, t.currency, t.description, t.status,
                t.idempotency_key, t.created_at, t.completed_at,
                le.id as entry_id, le.account_id, le.direction,
                le.amount as entry_amount, le.running_balance, le.created_at as entry_at
           FROM transactions t
           LEFT JOIN ledger_entries le ON le.transaction_id = t.id
          WHERE t.id=$1`,
        [req.params.id]
      );

      if (rows.length === 0) throw new NotFoundError('Transaction');

      const txn = rows[0];
      // Authorisation: user must own the initiating side or a participating account
      const [ownsFrom, ownsTo] = await Promise.all([
        pool.query(
          'SELECT id FROM accounts WHERE id=$1 AND user_id=$2',
          [txn.from_account_id, req.user.id]
        ),
        pool.query(
          'SELECT id FROM accounts WHERE id=$1 AND user_id=$2',
          [txn.to_account_id, req.user.id]
        ),
      ]);
      const initiated = txn.initiated_by === req.user.id;

      if (!initiated && ownsFrom.rows.length === 0 && ownsTo.rows.length === 0) {
        throw new ForbiddenError();
      }

      const entries = rows
        .filter((r) => r.entry_id)
        .map((r) => ({
          id: r.entry_id,
          account_id: r.account_id,
          direction: r.direction,
          amount: fromCents(BigInt(r.entry_amount)),
          running_balance: fromCents(BigInt(r.running_balance)),
          created_at: r.entry_at,
        }));

      res.json({
        success: true,
        data: {
          id: txn.id,
          from_account_id: txn.from_account_id,
          to_account_id: txn.to_account_id,
          amount: fromCents(BigInt(txn.amount)),
          currency: txn.currency,
          description: txn.description,
          status: txn.status,
          idempotency_key: txn.idempotency_key,
          created_at: txn.created_at,
          completed_at: txn.completed_at,
          ledger_entries: entries,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

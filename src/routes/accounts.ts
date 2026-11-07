import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { writeAudit } from '../services/auditService';
import { fromCents } from '../types';
import { ForbiddenError, NotFoundError } from '../utils/errors';

const router = Router();

const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  currency: z
    .string()
    .length(3)
    .toUpperCase()
    .default('USD'),
  initialBalance: z
    .number()
    .nonnegative()
    .default(0),
});

// GET /accounts — list caller's accounts
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, currency, balance, is_active, created_at, updated_at
           FROM accounts
          WHERE user_id=$1
          ORDER BY created_at ASC`,
        [req.user.id]
      );
      res.json({
        success: true,
        data: rows.map((r) => ({
          ...r,
          balance: fromCents(BigInt(r.balance)),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /accounts — create a new account
router.post(
  '/',
  requireAuth,
  validate(createAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, currency, initialBalance } = req.body as {
        name: string;
        currency: string;
        initialBalance: number;
      };
      const balanceCents = BigInt(Math.round(initialBalance * 100));

      const { rows } = await pool.query<{
        id: string;
        name: string;
        currency: string;
        balance: string;
        is_active: boolean;
        created_at: Date;
      }>(
        `INSERT INTO accounts (user_id, name, currency, balance)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, currency, balance, is_active, created_at`,
        [req.user.id, name, currency, balanceCents.toString()]
      );
      const account = rows[0];

      await writeAudit({
        eventType: 'account.created',
        actorId: req.user.id,
        resourceType: 'account',
        resourceId: account.id,
        payload: { name, currency, initial_balance: balanceCents.toString() },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({
        success: true,
        data: { ...account, balance: fromCents(BigInt(account.balance)) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /accounts/:id — get a single account (must own it)
router.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, user_id, name, currency, balance, is_active, created_at, updated_at
           FROM accounts WHERE id=$1`,
        [req.params.id]
      );
      if (rows.length === 0) throw new NotFoundError('Account');
      if (rows[0].user_id !== req.user.id) throw new ForbiddenError();
      const r = rows[0];
      res.json({
        success: true,
        data: { ...r, balance: fromCents(BigInt(r.balance)) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /accounts/:id — close (soft-delete) an account
router.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, user_id, balance FROM accounts WHERE id=$1',
        [req.params.id]
      );
      if (rows.length === 0) throw new NotFoundError('Account');
      if (rows[0].user_id !== req.user.id) throw new ForbiddenError();
      if (BigInt(rows[0].balance) !== 0n) {
        res.status(422).json({
          success: false,
          error: 'Cannot close an account with a non-zero balance',
          code: 'NON_ZERO_BALANCE',
        });
        return;
      }

      await pool.query(
        `UPDATE accounts SET is_active=FALSE, updated_at=NOW() WHERE id=$1`,
        [req.params.id]
      );

      await writeAudit({
        eventType: 'account.closed',
        actorId: req.user.id,
        resourceType: 'account',
        resourceId: req.params.id,
        payload: {},
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true, message: 'Account closed' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

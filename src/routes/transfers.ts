import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { idempotency } from '../middleware/idempotency';
import { validate } from '../middleware/validate';
import { transferFunds } from '../services/ledgerService';
import { toCents } from '../types';

const router = Router();

const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a positive decimal with up to 2 decimal places'),
  currency: z.string().length(3).toUpperCase().default('USD'),
  description: z.string().max(255).optional(),
});

// POST /transfers
router.post(
  '/',
  requireAuth,
  validate(transferSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        from_account_id,
        to_account_id,
        amount,
        currency,
        description,
      } = req.body as {
        from_account_id: string;
        to_account_id: string;
        amount: string;
        currency: string;
        description?: string;
      };

      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const result = await transferFunds({
        fromAccountId: from_account_id,
        toAccountId: to_account_id,
        amount: toCents(amount),
        currency,
        description,
        idempotencyKey,
        initiatedBy: req.user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string,
      });

      const statusCode = result.replayed ? 200 : 201;
      res.status(statusCode).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

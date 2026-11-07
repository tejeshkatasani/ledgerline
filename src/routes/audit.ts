import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { verifyAuditChain } from '../services/auditService';

const router = Router();

// GET /audit — fetch the caller's own audit events
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 100);
      const offset = parseInt((req.query.offset as string) ?? '0', 10);

      const { rows } = await pool.query(
        `SELECT id, event_type, resource_type, resource_id,
                payload, ip_address, created_at
           FROM audit_log
          WHERE actor_id=$1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );

      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

// GET /audit/verify — verify integrity of the entire audit chain
router.get(
  '/verify',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyAuditChain();
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

/**
 * Idempotency middleware.
 */
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

export function idempotency(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.headers['idempotency-key'] as string | undefined;
  if (!key) {
    next();
    return;
  }

  const userId = req.user?.id;
  const path = req.path;

  pool
    .query<{ response_status: number; response_body: unknown }>(
      `SELECT response_status, response_body
         FROM idempotency_keys
        WHERE key=$1 AND user_id=$2 AND request_path=$3
          AND expires_at > NOW()`,
      [key, userId, path]
    )
    .then((result) => {
      if (result.rows.length > 0) {
        const { response_status, response_body } = result.rows[0];
        res.status(response_status).json(response_body);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        pool
          .query(
            `INSERT INTO idempotency_keys
               (key, user_id, request_path, response_status, response_body)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (key) DO NOTHING`,
            [key, userId, path, res.statusCode, JSON.stringify(body)]
          )
          .catch((err) =>
            console.error('Failed to store idempotency key:', err)
          );
        return originalJson(body);
      };

      next();
    })
    .catch(next);
}

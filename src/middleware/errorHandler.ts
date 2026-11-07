import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
    return;
  }

  // PostgreSQL unique-violation (idempotency_key conflict race)
  if ((err as NodeJS.ErrnoException).code === '23505') {
    res.status(409).json({
      success: false,
      error: 'Duplicate request — idempotency key already used',
      code: 'CONFLICT',
    });
    return;
  }

  // Serialization failure — tell client to retry
  if ((err as NodeJS.ErrnoException).code === '40001') {
    res.status(409).json({
      success: false,
      error: 'Transaction conflict, please retry',
      code: 'SERIALIZATION_FAILURE',
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}

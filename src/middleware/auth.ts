import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { UnauthorizedError } from '../utils/errors';

/**
 * Require a valid Bearer JWT.
 * Attaches req.user = { id, email } on success.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Authorization header missing or malformed'));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

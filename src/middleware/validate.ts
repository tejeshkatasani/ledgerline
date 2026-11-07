import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Returns an Express middleware that validates req.body against a Zod schema.
 * Responds with 422 + field-level details on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = (result.error as ZodError).errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { registerUser, loginUser } from '../services/authService';
import { validate } from '../middleware/validate';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/register
router.post(
  '/register',
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const ip = req.ip;
      const result = await registerUser(email, password, ip);
      res.status(201).json({
        success: true,
        data: { id: result.id, email: result.email, token: result.token },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const ip = req.ip;
      const result = await loginUser(email, password, ip);
      res.json({
        success: true,
        data: { id: result.id, email: result.email, token: result.token },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

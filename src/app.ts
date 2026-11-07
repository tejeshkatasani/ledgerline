import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './utils/config';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth';
import accountRoutes from './routes/accounts';
import transferRoutes from './routes/transfers';
import transactionRoutes from './routes/transactions';
import auditRoutes from './routes/audit';

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.nodeEnv === 'test' ? 100000 : config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMITED',
  },
});
app.use(limiter);

// Stricter limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: config.nodeEnv === 'test' ? 100000 : 20,
  message: {
    success: false,
    error: 'Too many authentication attempts',
    code: 'RATE_LIMITED',
  },
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ── Health check (no auth) ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ledgerline', version: '1.0.0' });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/accounts', accountRoutes);
app.use('/transfers', transferRoutes);
app.use('/transactions', transactionRoutes);
app.use('/audit', auditRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;

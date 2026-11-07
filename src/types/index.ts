import { Request } from 'express';

// Re-export the augmented Request as AuthenticatedRequest for clarity
// (req.user is guaranteed present after requireAuth middleware)
export type AuthenticatedRequest = Request;

// ── Domain types ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  currency: string;
  balance: bigint;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Transaction {
  id: string;
  initiated_by: string;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: bigint;
  currency: string;
  description: string | null;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  idempotency_key: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: 'debit' | 'credit';
  amount: bigint;
  running_balance: bigint;
  created_at: Date;
}

export interface AuditLogEntry {
  id: number;
  event_type: string;
  actor_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  row_hash: string;
  created_at: Date;
}

// ── API response shape ────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ── Minor-unit helpers ────────────────────────────────────────────────────────
// All monetary values cross the API boundary as decimal strings (e.g. "10.50")
// and are stored as BIGINT cents internally.

export function toCents(decimal: string | number): bigint {
  const n = typeof decimal === 'string' ? parseFloat(decimal) : decimal;
  if (!isFinite(n) || n < 0) throw new Error(`Invalid amount: ${decimal}`);
  return BigInt(Math.round(n * 100));
}

export function fromCents(cents: bigint | number | string): string {
  const n = BigInt(cents);
  const abs = n < 0n ? -n : n;
  const sign = n < 0n ? '-' : '';
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`;
}

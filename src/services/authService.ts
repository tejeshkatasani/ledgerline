import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { config } from '../utils/config';
import { writeAudit } from './auditService';
import { ConflictError, UnauthorizedError } from '../utils/errors';

const SALT_ROUNDS = 12;

export interface TokenPayload {
  sub: string;   // user id
  email: string;
  iat?: number;
  exp?: number;
}

export async function registerUser(
  email: string,
  password: string,
  ipAddress?: string
): Promise<{ id: string; email: string; token: string }> {
  // Check for existing user
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [
    email,
  ]);
  if (existing.rows.length > 0) {
    throw new ConflictError('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email`,
    [email, passwordHash]
  );
  const user = result.rows[0];
  const token = signToken(user.id, user.email);

  await writeAudit({
    eventType: 'user.registered',
    actorId: user.id,
    resourceType: 'user',
    resourceId: user.id,
    payload: { email },
    ipAddress,
  });

  return { id: user.id, email: user.email, token };
}

export async function loginUser(
  email: string,
  password: string,
  ipAddress?: string
): Promise<{ id: string; email: string; token: string }> {
  const result = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
  }>('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);

  // Always run bcrypt even on missing user to prevent timing attacks
  const dummyHash =
    '$2a$12$invalidhashtopreventtimingattacksXXXXXXXXXXXXXXXXXXXXXX';
  const hash = result.rows[0]?.password_hash ?? dummyHash;
  const valid = await bcrypt.compare(password, hash);

  if (result.rows.length === 0 || !valid) {
    await writeAudit({
      eventType: 'user.login_failed',
      actorId: null,
      resourceType: 'user',
      resourceId: null,
      payload: { email },
      ipAddress,
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];
  const token = signToken(user.id, user.email);

  await writeAudit({
    eventType: 'user.login',
    actorId: user.id,
    resourceType: 'user',
    resourceId: user.id,
    payload: { email },
    ipAddress,
  });

  return { id: user.id, email: user.email, token };
}

function signToken(userId: string, email: string): string {
  return jwt.sign(
    { sub: userId, email } as TokenPayload,
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

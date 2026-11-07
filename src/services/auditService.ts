/**
 * Audit log service.
 *
 * Every write to audit_log:
 *  1. Fetches the hash of the most-recently inserted row (prev_hash).
 *  2. Computes an HMAC-SHA256 over (event_type, actor_id, resource_type,
 *     resource_id, payload, created_at, prev_hash).
 *  3. Inserts the new row with both prev_hash and row_hash.
 *
 * Because each hash covers the previous one, any tampering with a historical
 * row breaks all subsequent hashes — detectable by verifyChain().
 */
import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { buildAuditRowCanonical, hmacSha256 } from '../utils/crypto';

export type AuditEventType =
  | 'user.registered'
  | 'user.login'
  | 'user.login_failed'
  | 'account.created'
  | 'account.closed'
  | 'transfer.initiated'
  | 'transfer.completed'
  | 'transfer.failed'
  | 'transfer.duplicate_blocked'
  | 'transfer.reversed'
  | 'idempotency.replayed';

interface WriteAuditParams {
  eventType: AuditEventType;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Pass an existing client to participate in the same transaction */
  client?: PoolClient;
}

export async function writeAudit(params: WriteAuditParams): Promise<void> {
  const {
    eventType,
    actorId = null,
    resourceType = null,
    resourceId = null,
    payload = {},
    ipAddress = null,
    userAgent = null,
    client: externalClient,
  } = params;

  const useClient = externalClient ?? (await pool.connect());
  const shouldRelease = !externalClient;

  try {
    // Fetch hash of latest row (serialised — must hold a lock to be safe in
    // a concurrent environment; FOR UPDATE on the last row achieves this).
    const prevResult = await useClient.query<{ row_hash: string }>(
      `SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE`
    );
    const prevHash = prevResult.rows[0]?.row_hash ?? null;
    const now = new Date().toISOString();

    const canonical = buildAuditRowCanonical({
      eventType,
      actorId,
      resourceType,
      resourceId,
      payload,
      createdAt: now,
      prevHash,
    });
    const rowHash = hmacSha256(canonical);

    await useClient.query(
      `INSERT INTO audit_log
         (event_type, actor_id, resource_type, resource_id,
          payload, ip_address, user_agent, prev_hash, row_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        eventType,
        actorId,
        resourceType,
        resourceId,
        JSON.stringify(payload),
        ipAddress,
        userAgent,
        prevHash,
        rowHash,
        now,
      ]
    );
  } finally {
    if (shouldRelease) {
      (useClient as PoolClient).release();
    }
  }
}

/**
 * Verify the integrity of the entire audit chain.
 * Returns { valid: true } or { valid: false, firstBadId: number }.
 */
export async function verifyAuditChain(): Promise<
  { valid: true } | { valid: false; firstBadId: number }
> {
  const { rows } = await pool.query<{
    id: number;
    event_type: string;
    actor_id: string | null;
    resource_type: string | null;
    resource_id: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
    prev_hash: string | null;
    row_hash: string;
  }>(`SELECT * FROM audit_log ORDER BY id ASC`);

  for (const row of rows) {
    const canonical = buildAuditRowCanonical({
      eventType: row.event_type,
      actorId: row.actor_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      payload: row.payload,
      createdAt: new Date(row.created_at).toISOString(),
      prevHash: row.prev_hash,
    });
    const expected = hmacSha256(canonical);
    if (expected !== row.row_hash) {
      return { valid: false, firstBadId: row.id };
    }
  }
  return { valid: true };
}

import crypto from 'crypto';
import { config } from './config';

/**
 * Compute an HMAC-SHA256 signature over the given data.
 * Used to produce tamper-evident hashes for audit log rows.
 */
export function hmacSha256(data: string): string {
  return crypto
    .createHmac('sha256', config.auditHmacSecret)
    .update(data)
    .digest('hex');
}

/**
 * Build the canonical string for an audit log row.
 * Includes the previous row hash to chain entries.
 */
export function buildAuditRowCanonical(params: {
  eventType: string;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  prevHash: string | null;
}): string {
  return JSON.stringify({
    event_type: params.eventType,
    actor_id: params.actorId,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    payload: params.payload,
    created_at: params.createdAt,
    prev_hash: params.prevHash ?? 'GENESIS',
  });
}

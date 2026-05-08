/**
 * Hash-chain utilities for the append-only audit log.
 *
 * Each audit log entry contains:
 *  - payload_hash : SHA-256 over a canonical JSON string of the entry's own fields
 *  - prev_hash    : payload_hash of the immediately preceding row
 *
 * This allows offline verification that the log has not been tampered with.
 */

import { createHash } from "node:crypto";

export interface AuditEntryFields {
  tenantId?: string | null;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string | null | undefined;
  resourceId: string | null | undefined;
  payloadJson: Record<string, unknown>;
  ts: string;
}

/**
 * Compute the SHA-256 hash for one audit entry.
 * The input is a deterministic, sorted JSON string to avoid key-ordering issues.
 */
export function computePayloadHash(entry: AuditEntryFields): string {
  const canonical = JSON.stringify({
    tenantId: entry.tenantId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    payloadJson: entry.payloadJson,
    ts: entry.ts
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Verify a chain segment.
 * Returns the list of broken links (empty = chain intact).
 */
export interface ChainLink {
  id: number;
  payloadHash: string;
  prevHash: string | null;
}

export interface BrokenLink {
  id: number;
  expected: string | null;
  actual: string | null;
  reason: string;
}

export function verifyChain(links: ChainLink[]): BrokenLink[] {
  const broken: BrokenLink[] = [];
  let previousHash: string | null = null;
  for (const link of links) {
    if (link.prevHash !== previousHash) {
      broken.push({
        id: link.id,
        expected: previousHash,
        actual: link.prevHash,
        reason: "prev_hash mismatch"
      });
    }
    previousHash = link.payloadHash;
  }
  return broken;
}

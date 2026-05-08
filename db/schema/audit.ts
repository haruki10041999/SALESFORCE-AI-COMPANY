/**
 * Drizzle ORM schema for the append-only audit log.
 *
 * Every row includes:
 *  - payload_hash : SHA-256 of canonical JSON(actor_type, actor_id, action,
 *                   resource_type, resource_id, payload_json, ts)
 *  - prev_hash    : payload_hash of the preceding row (NULL for first row)
 *
 * Together they form a hash chain that makes tampering detectable.
 * tombstone marks logically-deleted entries (GDPR right-to-erasure without
 * breaking the chain).
 */

import { bigserial, boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    tenantId: text("tenant_id"),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id").notNull().default("system"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    payloadHash: text("payload_hash").notNull(),
    prevHash: text("prev_hash"),
    /** When true the payload content has been erased for GDPR compliance. */
    tombstone: boolean("tombstone").notNull().default(false)
  },
  (t) => ({
    tsIdx: index("idx_audit_log_ts").on(t.ts),
    tenantTsIdx: index("idx_audit_log_tenant_ts").on(t.tenantId, t.ts),
    actorIdx: index("idx_audit_log_actor").on(t.actorType, t.actorId),
    actionIdx: index("idx_audit_log_action").on(t.action),
    resourceIdx: index("idx_audit_log_resource").on(t.resourceType, t.resourceId)
  })
);

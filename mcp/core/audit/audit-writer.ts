/**
 * Durable, hash-chained audit log writer.
 *
 * Each call to append():
 *  1. Computes payload_hash over the entry's own fields
 *  2. Fetches prev_hash = payload_hash of the latest existing row (FOR UPDATE)
 *  3. Inserts the new row atomically
 *
 * This runs inside a transaction so concurrent writers serialize correctly.
 *
 * Usage:
 *   const writer = await AuditWriter.open({ databaseUrl });
 *   await writer.append({
 *     actorType: "user", actorId: "u-123",
 *     action: "proposal.approve",
 *     resourceType: "skill", resourceId: "skill-abc",
 *     payload: { reason: "looks good" }
 *   });
 */

import { Pool } from "pg";
import { computePayloadHash, verifyChain, type BrokenLink } from "./hash-chain.js";
import { currentTenantId } from "../identity/tenant-context.js";
import { ensureTenantRlsPolicy, resetTenantSetting, setTenantSetting, withTenantScopedClient } from "../persistence/postgres-tenant-context.js";
import { getOrCreatePgPool, releasePgPoolKey } from "../persistence/pg-pool-registry.js";

export interface AuditWriterOptions {
  databaseUrl: string;
}

export interface AppendAuditInput {
  tenantId?: string | null;
  actorType: string;
  actorId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
  ts?: string;
}

export interface AuditRow {
  id: number;
  ts: string;
  tenantId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payloadJson: Record<string, unknown>;
  payloadHash: string;
  prevHash: string | null;
  tombstone: boolean;
}

export class AuditWriter {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private schemaReady = false;

  private constructor(pool: Pool, poolKey: string) {
    this.pool = pool;
    this.poolKey = poolKey;
  }

  public static async open(options: AuditWriterOptions): Promise<AuditWriter> {
    if (!options.databaseUrl?.trim()) {
      throw new Error("DATABASE_URL is required for AuditWriter");
    }
    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `audit-writer:${normalizedUrl}`;
    const pool = getOrCreatePgPool(poolKey, normalizedUrl);
    const writer = new AuditWriter(pool, poolKey);
    await writer.ensureSchema();
    return writer;
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  /**
   * Append one audit entry. Returns the inserted row's id.
   */
  public async append(input: AppendAuditInput): Promise<number> {
    await this.ensureSchema();
    const ts = input.ts ?? new Date().toISOString();
    const tenantId = input.tenantId ?? currentTenantId() ?? null;
    const payloadJson = input.payload ?? {};

    const payloadHash = computePayloadHash({
      tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      payloadJson,
      ts
    });

    const client = await this.pool.connect();
    try {
      await setTenantSetting(client, tenantId ?? undefined);
      await client.query("BEGIN");

      // Fetch the most recent hash to link the chain (FOR UPDATE prevents concurrent insert races)
      const prevResult = await client.query<{ payload_hash: string }>(
        "SELECT payload_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE"
      );
      const prevHash: string | null = prevResult.rows[0]?.payload_hash ?? null;

      const insertResult = await client.query<{ id: number }>(
        [
          "INSERT INTO audit_log",
          "  (ts, tenant_id, actor_type, actor_id, action, resource_type, resource_id, payload_json, payload_hash, prev_hash)",
          "VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
          "RETURNING id"
        ].join("\n"),
        [
          ts,
          tenantId,
          input.actorType,
          input.actorId,
          input.action,
          input.resourceType ?? null,
          input.resourceId ?? null,
          JSON.stringify(payloadJson),
          payloadHash,
          prevHash
        ]
      );

      await client.query("COMMIT");
      return insertResult.rows[0]!.id;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      await resetTenantSetting(client);
      client.release();
    }
  }

  /**
   * Soft-delete (tombstone) an entry for GDPR compliance.
   * The row remains to preserve the hash chain, but payload_json is cleared.
   */
  public async tombstone(id: number): Promise<void> {
    await this.ensureSchema();
    await withTenantScopedClient(this.pool, (client) => client.query(
      [
        "UPDATE audit_log",
        "SET tombstone = true, payload_json = '{}'::jsonb",
        "WHERE id = $1"
      ].join("\n"),
      [id]
    ));
  }

  /**
   * List recent audit entries. Excludes tombstoned rows by default.
   */
  public async list(options?: {
    limit?: number;
    tenantId?: string;
    actorId?: string;
    action?: string;
    resourceType?: string;
    includeTombstoned?: boolean;
  }): Promise<AuditRow[]> {
    await this.ensureSchema();
    const params: Array<string | number | boolean> = [];
    const where: string[] = [];

    if (!options?.includeTombstoned) {
      where.push("tombstone = false");
    }
    const tenantId = options?.tenantId ?? currentTenantId();
    if (tenantId) {
      params.push(tenantId);
      where.push(`tenant_id = $${params.length}`);
    } else {
      where.push("tenant_id IS NULL");
    }
    if (options?.actorId) {
      params.push(options.actorId);
      where.push(`actor_id = $${params.length}`);
    }
    if (options?.action) {
      params.push(options.action);
      where.push(`action = $${params.length}`);
    }
    if (options?.resourceType) {
      params.push(options.resourceType);
      where.push(`resource_type = $${params.length}`);
    }
    const limit = options?.limit ?? 200;
    params.push(limit);

    const result = await withTenantScopedClient(this.pool, (client) => client.query<{
      id: number | string;
      ts: Date | string;
      tenant_id: string | null;
      actor_type: string;
      actor_id: string;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      payload_json: unknown;
      payload_hash: string;
      prev_hash: string | null;
      tombstone: boolean;
    }>(
      [
        "SELECT id, ts, tenant_id, actor_type, actor_id, action, resource_type, resource_id,",
        "       payload_json, payload_hash, prev_hash, tombstone",
        "FROM audit_log",
        where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
        "ORDER BY id DESC",
        `LIMIT $${params.length}`
      ].filter(Boolean).join("\n"),
      params
    ), tenantId);

    return result.rows.map((r) => ({
      id: Number(r.id),
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      tenantId: r.tenant_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      payloadJson: (typeof r.payload_json === "string" ? JSON.parse(r.payload_json) : r.payload_json ?? {}) as Record<string, unknown>,
      payloadHash: r.payload_hash,
      prevHash: r.prev_hash,
      tombstone: r.tombstone
    }));
  }

  /**
   * Verify integrity of the most recent `limit` rows.
   * Returns broken links (empty = chain intact).
   */
  public async verifyChain(limit = 1000): Promise<BrokenLink[]> {
    await this.ensureSchema();
    const result = await withTenantScopedClient(this.pool, (client) => client.query<{ id: number | string; payload_hash: string; prev_hash: string | null }>(
      [
        "SELECT id, payload_hash, prev_hash",
        "FROM audit_log",
        "ORDER BY id ASC",
        `LIMIT $1`
      ].join("\n"),
      [limit]
    ));
    const links = result.rows.map((r) => ({
      id: Number(r.id),
      payloadHash: r.payload_hash,
      prevHash: r.prev_hash
    }));
    return verifyChain(links);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id            bigserial PRIMARY KEY,
          ts            timestamptz NOT NULL DEFAULT now(),
          tenant_id     text,
          actor_type    text NOT NULL DEFAULT 'system',
          actor_id      text NOT NULL DEFAULT 'system',
          action        text NOT NULL,
          resource_type text,
          resource_id   text,
          payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
          payload_hash  text NOT NULL,
          prev_hash     text,
          tombstone     boolean NOT NULL DEFAULT false
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_log_ts     ON audit_log(ts DESC)");
      await client.query("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id text");
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_ts ON audit_log(tenant_id, ts DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor_type, actor_id)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id)");
      await ensureTenantRlsPolicy(client, "audit_log", "audit_log_tenant_isolation");
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }
}

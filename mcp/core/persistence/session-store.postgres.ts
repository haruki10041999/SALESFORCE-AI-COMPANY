import { Pool } from "pg";
import type { OrchestrationSession } from "../types/index.js";
import type { SessionStatus, SessionStore, SessionSummary, UpsertResult } from "./session-store.js";
import { currentTenantId } from "../identity/tenant-context.js";
import { ensureTenantRlsPolicy, withTenantScopedClient } from "./postgres-tenant-context.js";
import { getOrCreatePgPool, releasePgPoolKey } from "./pg-pool-registry.js";

export interface PostgresSessionStoreOptions {
  databaseUrl: string;
  retentionDays?: number;
}

/**
 * Postgres-backed session store with pg_try_advisory_lock support.
 *
 * Advisory lock key: hashtext('session:' || id) — a 32-bit integer derived
 * from the session id string, which fits pg_try_advisory_lock(bigint).
 */
export class PostgresSessionStore implements SessionStore {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private readonly retentionDays: number;
  private schemaReady = false;

  private constructor(pool: Pool, poolKey: string, retentionDays: number) {
    this.pool = pool;
    this.poolKey = poolKey;
    this.retentionDays = retentionDays;
  }

  public static async open(options: PostgresSessionStoreOptions): Promise<PostgresSessionStore> {
    if (!options.databaseUrl?.trim()) {
      throw new Error("DATABASE_URL is required for PostgresSessionStore");
    }
    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `session-store.postgres:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const pool = getOrCreatePgPool(poolKey, normalizedUrl);
    const store = new PostgresSessionStore(pool, poolKey, options.retentionDays ?? 30);
    await store.ensureSchema();
    return store;
  }

  // ---------------------------------------------------------------------------
  // SessionStore interface
  // ---------------------------------------------------------------------------

  public async getById(sessionId: string): Promise<OrchestrationSession | null> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await withTenantScopedClient(
      this.pool,
      (client) => client.query<{ session_json: unknown }>(
        tenantId
          ? "SELECT session_json FROM orchestration_sessions WHERE id = $1 AND tenant_id = $2"
          : "SELECT session_json FROM orchestration_sessions WHERE id = $1 AND tenant_id IS NULL",
        tenantId ? [sessionId, tenantId] : [sessionId]
      ),
      tenantId
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.parseSessionJson(row.session_json) as OrchestrationSession;
  }

  public async upsert(
    session: OrchestrationSession,
    expectedVersion: number
  ): Promise<UpsertResult> {
    await this.ensureSchema();
    const tenantId = currentTenantId() ?? null;
    const sessionJson = JSON.stringify(session);
    const historyCount = Array.isArray(session.history) ? session.history.length : 0;

    if (expectedVersion < 0) {
      // Initial insert — no version check
      const result = await withTenantScopedClient(
        this.pool,
        (client) => client.query<{ version: number }>(
          [
            "INSERT INTO orchestration_sessions",
            "  (id, tenant_id, session_json, history_count, updated_at, version, status)",
            "VALUES ($1, $2, $3::jsonb, $4, NOW(), 1, 'active'::session_status)",
            "ON CONFLICT(id) DO UPDATE SET",
            "  tenant_id      = EXCLUDED.tenant_id,",
            "  session_json   = EXCLUDED.session_json,",
            "  history_count  = EXCLUDED.history_count,",
            "  updated_at     = NOW(),",
            "  version        = orchestration_sessions.version + 1",
            "WHERE orchestration_sessions.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id",
            "RETURNING version"
          ].join("\n"),
          [session.id, tenantId, sessionJson, historyCount]
        ),
        tenantId ?? undefined
      );
      if ((result.rowCount ?? 0) === 0) {
        return { updated: false };
      }
      return { updated: true, version: result.rows[0]?.version };
    }

    // Optimistic-lock upsert: only write if current version matches expectedVersion
    const result = await withTenantScopedClient(
      this.pool,
      (client) => client.query<{ version: number }>(
        [
          "UPDATE orchestration_sessions",
          "SET",
          "  session_json  = $1::jsonb,",
          "  history_count = $2,",
          "  updated_at    = NOW(),",
          "  version       = version + 1",
          tenantId
            ? "WHERE id = $3 AND version = $4 AND tenant_id = $5"
            : "WHERE id = $3 AND version = $4 AND tenant_id IS NULL",
          "RETURNING version"
        ].join("\n"),
        tenantId
          ? [sessionJson, historyCount, session.id, expectedVersion, tenantId]
          : [sessionJson, historyCount, session.id, expectedVersion]
      ),
      tenantId ?? undefined
    );

    if (result.rowCount === 0) {
      return { updated: false };
    }
    return { updated: true, version: result.rows[0]?.version };
  }

  public async setStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    await withTenantScopedClient(
      this.pool,
      (client) => client.query(
        tenantId
          ? "UPDATE orchestration_sessions SET status = $1::session_status, updated_at = NOW() WHERE id = $2 AND tenant_id = $3"
          : "UPDATE orchestration_sessions SET status = $1::session_status, updated_at = NOW() WHERE id = $2 AND tenant_id IS NULL",
        tenantId ? [status, sessionId, tenantId] : [status, sessionId]
      ),
      tenantId
    );
  }

  /**
   * Acquire pg_try_advisory_lock using hashtext(key).
   * Lock is session-scoped (auto-released on connection close / transaction end).
   * We manually track lock ownership via locked_at / lock_owner columns so that
   * stale locks can be detected and force-released after a timeout.
   */
  public async acquireLock(sessionId: string, lockOwner: string): Promise<boolean> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    return withTenantScopedClient(this.pool, async (client) => {
      const lockResult = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
        [`session:${sessionId}`]
      );
      const acquired = lockResult.rows[0]?.acquired === true;
      if (acquired) {
        await client.query(
          [
            "UPDATE orchestration_sessions",
            "SET locked_at = NOW(), lock_owner = $1",
            tenantId ? "WHERE id = $2 AND tenant_id = $3" : "WHERE id = $2 AND tenant_id IS NULL"
          ].join("\n"),
          tenantId ? [lockOwner, sessionId, tenantId] : [lockOwner, sessionId]
        );
      }
      return acquired;
    }, tenantId);
  }

  public async releaseLock(sessionId: string, lockOwner: string): Promise<void> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    await withTenantScopedClient(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
        [`session:${sessionId}`]
      );
      await client.query(
        [
          "UPDATE orchestration_sessions",
          "SET locked_at = NULL, lock_owner = NULL",
          tenantId
            ? "WHERE id = $1 AND lock_owner = $2 AND tenant_id = $3"
            : "WHERE id = $1 AND lock_owner = $2 AND tenant_id IS NULL"
        ].join("\n"),
        tenantId ? [sessionId, lockOwner, tenantId] : [sessionId, lockOwner]
      );
    }, tenantId);
  }

  public async list(limit = 200): Promise<SessionSummary[]> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await withTenantScopedClient(
      this.pool,
      (client) => client.query<{
        id: string;
        session_json: unknown;
        version: number;
        status: string;
        updated_at: Date | string;
      }>(
        [
          "SELECT id, session_json, version, status, updated_at",
          "FROM orchestration_sessions",
          tenantId ? "WHERE tenant_id = $2" : "WHERE tenant_id IS NULL",
          "ORDER BY updated_at DESC",
          tenantId ? "LIMIT $1" : "LIMIT $1"
        ].join("\n"),
        tenantId ? [limit, tenantId] : [limit]
      ),
      tenantId
    );

    return result.rows.map((row) => {
      const s = this.parseSessionJson(row.session_json) as OrchestrationSession & {
        topic?: string;
        agents?: string[];
        queue?: unknown[];
        firedRules?: string[];
      };
      return {
        id: s.id,
        topic: s.topic ?? "",
        agents: Array.isArray(s.agents) ? s.agents : [],
        queueLength: Array.isArray(s.queue) ? s.queue.length : 0,
        historyCount: Array.isArray(s.history) ? s.history.length : 0,
        firedRuleCount: Array.isArray(s.firedRules) ? s.firedRules.length : 0,
        status: (row.status ?? "active") as SessionSummary["status"],
        version: row.version ?? 0,
        updatedAt: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at)
      };
    });
  }

  public async archiveOld(): Promise<{ archived: number }> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const threshold = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = await withTenantScopedClient(
      this.pool,
      (client) => client.query(
        [
          "UPDATE orchestration_sessions",
          "SET status = 'completed'::session_status",
          tenantId
            ? "WHERE updated_at < $1::timestamptz AND status = 'active'::session_status AND tenant_id = $2"
            : "WHERE updated_at < $1::timestamptz AND status = 'active'::session_status AND tenant_id IS NULL"
        ].join("\n"),
        tenantId ? [threshold, tenantId] : [threshold]
      ),
      tenantId
    );
    return { archived: result.rowCount ?? 0 };
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseSessionJson(raw: unknown): unknown {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw ?? {};
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const client = await this.pool.connect();
    try {
      // Ensure the enum type exists
      await client.query(`
        DO $$ BEGIN
          CREATE TYPE session_status AS ENUM ('active', 'paused', 'completed', 'failed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      // Ensure base table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orchestration_sessions (
          id            text PRIMARY KEY,
          tenant_id     text,
          session_json  jsonb NOT NULL,
          history_count integer NOT NULL DEFAULT 0,
          updated_at    timestamptz NOT NULL DEFAULT NOW(),
          version       integer NOT NULL DEFAULT 0,
          status        session_status NOT NULL DEFAULT 'active',
          locked_at     timestamptz,
          lock_owner    text
        )
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_updated_at ON orchestration_sessions(updated_at DESC)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_status ON orchestration_sessions(status)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_tenant_updated_at ON orchestration_sessions(tenant_id, updated_at DESC)"
      );
      // Add missing columns to pre-existing tables (idempotent)
      for (const ddl of [
        "ALTER TABLE orchestration_sessions ADD COLUMN IF NOT EXISTS tenant_id     text",
        "ALTER TABLE orchestration_sessions ADD COLUMN IF NOT EXISTS version       integer NOT NULL DEFAULT 0",
        "ALTER TABLE orchestration_sessions ADD COLUMN IF NOT EXISTS status        session_status NOT NULL DEFAULT 'active'",
        "ALTER TABLE orchestration_sessions ADD COLUMN IF NOT EXISTS locked_at     timestamptz",
        "ALTER TABLE orchestration_sessions ADD COLUMN IF NOT EXISTS lock_owner    text"
      ]) {
        await client.query(ddl);
      }
      await ensureTenantRlsPolicy(client, "orchestration_sessions", "orchestration_sessions_tenant_isolation");
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }
}

/**
 * SQLite-backed session store (single-process, no distributed locking).
 *
 * Advisory lock methods are no-ops — this implementation assumes single-process
 * deployment. Use PostgresSessionStore for multi-instance deployments.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OrchestrationSession } from "../types/index.js";
import type { SessionStatus, SessionStore, SessionSummary, UpsertResult } from "./session-store.js";
import { currentTenantId } from "../identity/tenant-context.js";

export interface SqliteSessionStoreOptions {
  dbPath: string;
  retentionDays?: number;
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;
  private readonly retentionDays: number;

  private constructor(db: DatabaseSync, retentionDays: number) {
    this.db = db;
    this.retentionDays = retentionDays;
    this.ensureSchema();
  }

  public static open(options: SqliteSessionStoreOptions): SqliteSessionStore {
    const dbPath = resolve(options.dbPath);
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const db = new DatabaseSync(dbPath);
    return new SqliteSessionStore(db, options.retentionDays ?? 30);
  }

  // ---------------------------------------------------------------------------
  // SessionStore interface
  // ---------------------------------------------------------------------------

  public async getById(sessionId: string): Promise<OrchestrationSession | null> {
    const tenantId = currentTenantId();
    const row = this.db
      .prepare(
        tenantId
          ? "SELECT session_json FROM orchestration_sessions WHERE id = ? AND tenant_id = ?"
          : "SELECT session_json FROM orchestration_sessions WHERE id = ? AND tenant_id IS NULL"
      )
      .get(...(tenantId ? [sessionId, tenantId] : [sessionId])) as { session_json: string } | undefined;
    if (!row) return null;
    return this.parse(row.session_json) as OrchestrationSession;
  }

  public async upsert(
    session: OrchestrationSession,
    expectedVersion: number
  ): Promise<UpsertResult> {
    const sessionJson = JSON.stringify(session);
    const historyCount = Array.isArray(session.history) ? session.history.length : 0;
    const now = new Date().toISOString();
    const tenantId = currentTenantId() ?? null;

    if (expectedVersion < 0) {
      // Initial insert without version check
      const insertResult = this.db.prepare(
        [
          "INSERT INTO orchestration_sessions",
          "  (id, tenant_id, session_json, history_count, updated_at, version, status)",
          "VALUES (?, ?, ?, ?, ?, 1, 'active')",
          "ON CONFLICT(id) DO UPDATE SET",
          "  tenant_id     = excluded.tenant_id,",
          "  session_json  = excluded.session_json,",
          "  history_count = excluded.history_count,",
          "  updated_at    = excluded.updated_at,",
          "  version       = orchestration_sessions.version + 1",
          "WHERE orchestration_sessions.tenant_id IS excluded.tenant_id"
        ].join("\n")
      ).run(session.id, tenantId, sessionJson, historyCount, now) as { changes: number };
      if (insertResult.changes === 0) {
        return { updated: false };
      }
      const vrow = this.db
        .prepare("SELECT version FROM orchestration_sessions WHERE id = ?")
        .get(session.id) as { version: number } | undefined;
      return { updated: true, version: vrow?.version };
    }

    const result = this.db.prepare(
      [
        "UPDATE orchestration_sessions",
        "SET",
        "  session_json  = ?,",
        "  history_count = ?,",
        "  updated_at    = ?,",
        "  version       = version + 1",
        tenantId
          ? "WHERE id = ? AND version = ? AND tenant_id = ?"
          : "WHERE id = ? AND version = ? AND tenant_id IS NULL"
      ].join("\n")
    ).run(...(tenantId
      ? [sessionJson, historyCount, now, session.id, expectedVersion, tenantId]
      : [sessionJson, historyCount, now, session.id, expectedVersion])) as { changes: number };

    if (result.changes === 0) {
      return { updated: false };
    }
    const vrow = this.db
      .prepare("SELECT version FROM orchestration_sessions WHERE id = ?")
      .get(session.id) as { version: number } | undefined;
    return { updated: true, version: vrow?.version };
  }

  public async setStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const tenantId = currentTenantId();
    this.db.prepare(
      tenantId
        ? "UPDATE orchestration_sessions SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
        : "UPDATE orchestration_sessions SET status = ?, updated_at = ? WHERE id = ? AND tenant_id IS NULL"
    ).run(...(tenantId ? [status, new Date().toISOString(), sessionId, tenantId] : [status, new Date().toISOString(), sessionId]));
  }

  /** No-op: SQLite assumes single-process ownership. Always returns true. */
  public async acquireLock(_sessionId: string, _lockOwner: string): Promise<boolean> {
    return true;
  }

  /** No-op. */
  public async releaseLock(_sessionId: string, _lockOwner: string): Promise<void> {
    // no-op
  }

  public async list(limit = 200): Promise<SessionSummary[]> {
    const tenantId = currentTenantId();
    const rows = this.db.prepare(
      [
        "SELECT id, session_json, version, status, updated_at",
        "FROM orchestration_sessions",
        tenantId ? "WHERE tenant_id = ?" : "WHERE tenant_id IS NULL",
        "ORDER BY updated_at DESC",
        "LIMIT ?"
      ].join("\n")
    ).all(...(tenantId ? [tenantId, limit] : [limit])) as Array<{
      id: string;
      session_json: string;
      version: number;
      status: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const s = this.parse(row.session_json) as OrchestrationSession & {
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
        status: (row.status ?? "active") as SessionStatus,
        version: row.version ?? 0,
        updatedAt: row.updated_at
      };
    });
  }

  public async archiveOld(): Promise<{ archived: number }> {
    const tenantId = currentTenantId();
    const threshold = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = this.db.prepare(
      [
        "UPDATE orchestration_sessions",
        "SET status = 'completed'",
        tenantId
          ? "WHERE updated_at < ? AND status = 'active' AND tenant_id = ?"
          : "WHERE updated_at < ? AND status = 'active' AND tenant_id IS NULL"
      ].join("\n")
    ).run(...(tenantId ? [threshold, tenantId] : [threshold])) as { changes: number };
    return { archived: result.changes };
  }

  public async close(): Promise<void> {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parse(raw: unknown): unknown {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw ?? {};
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_sessions (
        id            TEXT PRIMARY KEY,
        tenant_id     TEXT,
        session_json  TEXT NOT NULL,
        history_count INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        version       INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'active',
        locked_at     TEXT,
        lock_owner    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_updated_at
        ON orchestration_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_status
        ON orchestration_sessions(status);
    `);
    try {
      this.db.exec("ALTER TABLE orchestration_sessions ADD COLUMN tenant_id TEXT");
    } catch {
      // Column already exists.
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_tenant_updated_at ON orchestration_sessions(tenant_id, updated_at DESC)"
    );
  }
}

import { Pool, type PoolClient } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "../persistence/pg-pool-registry.js";

interface OrchestrationSessionShape {
  id: string;
  history: Array<unknown>;
}

export interface OrchestrationSessionSummary {
  id: string;
  topic: string;
  agents: string[];
  queueLength: number;
  historyCount: number;
  firedRuleCount: number;
}

export interface PostgresOrchestrationSessionStoreOptions<TSession extends OrchestrationSessionShape> {
  databaseUrl: string;
  getSession: (sessionId: string) => TSession | undefined;
  setSession: (session: TSession) => void;
  maxSessionFiles?: number;
  retentionDays?: number;
}

export class PostgresOrchestrationSessionStore<TSession extends OrchestrationSessionShape> {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private readonly getSession: (sessionId: string) => TSession | undefined;
  private readonly setSession: (session: TSession) => void;
  private readonly maxSessionFiles: number;
  private readonly retentionDays: number;
  private schemaReady = false;

  private constructor(pool: Pool, poolKey: string, options: PostgresOrchestrationSessionStoreOptions<TSession>) {
    this.pool = pool;
    this.poolKey = poolKey;
    this.getSession = options.getSession;
    this.setSession = options.setSession;
    this.maxSessionFiles = options.maxSessionFiles ?? 200;
    this.retentionDays = options.retentionDays ?? 30;
  }

  public static async open<TSession extends OrchestrationSessionShape>(
    options: PostgresOrchestrationSessionStoreOptions<TSession>
  ): Promise<PostgresOrchestrationSessionStore<TSession>> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PostgresOrchestrationSessionStore");
    }

    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `orchestration-session-store:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const pool = getOrCreatePgPool(poolKey, normalizedUrl);
    const store = new PostgresOrchestrationSessionStore(pool, poolKey, options);
    await store.ensureSchema();
    return store;
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  public async deleteOldSessions(): Promise<{ deletedByAge: number; deletedByCount: number; remaining: number }> {
    await this.ensureSchema();

    const ageThreshold = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const deleteAgeResult = await this.pool.query<{ id: string }>(
      [
        "DELETE FROM orchestration_sessions",
        "WHERE updated_at < $1::timestamptz",
        "RETURNING id"
      ].join("\n"),
      [ageThreshold]
    );

    const countResult = await this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM orchestration_sessions");
    const currentCount = Number(countResult.rows[0]?.count ?? "0");
    const overflow = Math.max(0, currentCount - this.maxSessionFiles);
    let deletedByCount = 0;

    if (overflow > 0) {
      const overflowResult = await this.pool.query<{ id: string }>(
        [
          "DELETE FROM orchestration_sessions",
          "WHERE id IN (",
          "  SELECT id FROM orchestration_sessions ORDER BY updated_at ASC LIMIT $1",
          ")",
          "RETURNING id"
        ].join("\n"),
        [overflow]
      );
      deletedByCount = overflowResult.rowCount ?? 0;
    }

    const remainingResult = await this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM orchestration_sessions");

    return {
      deletedByAge: deleteAgeResult.rowCount ?? 0,
      deletedByCount,
      remaining: Number(remainingResult.rows[0]?.count ?? "0")
    };
  }

  public async saveOrchestrationSession(
    sessionId: string
  ): Promise<{ sessionId: string; filePath: string; historyCount: number } | null> {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    await this.ensureSchema();
    const sessionJson = JSON.stringify(session);
    const historyCount = session.history.length;
    await this.pool.query(
      [
        "INSERT INTO orchestration_sessions(id, session_json, history_count, updated_at)",
        "VALUES ($1, $2::jsonb, $3, NOW())",
        "ON CONFLICT(id) DO UPDATE SET",
        "  session_json = EXCLUDED.session_json,",
        "  history_count = EXCLUDED.history_count,",
        "  updated_at = EXCLUDED.updated_at"
      ].join("\n"),
      [sessionId, sessionJson, historyCount]
    );
    await this.deleteOldSessions();

    return {
      sessionId,
      filePath: `postgres://orchestration_sessions/${sessionId}`,
      historyCount
    };
  }

  public async restoreOrchestrationSession(sessionId: string): Promise<TSession | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ session_json: unknown }>(
      "SELECT session_json FROM orchestration_sessions WHERE id = $1",
      [sessionId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const session = (typeof row.session_json === "string"
      ? JSON.parse(row.session_json)
      : row.session_json) as TSession;
    this.setSession(session);
    return session;
  }

  public async listOrchestrationSessions(limit = 200): Promise<OrchestrationSessionSummary[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ id: string; session_json: unknown }>(
      [
        "SELECT id, session_json",
        "FROM orchestration_sessions",
        "ORDER BY updated_at DESC",
        "LIMIT $1"
      ].join("\n"),
      [limit]
    );

    return result.rows.map((row) => {
      const session = (typeof row.session_json === "string"
        ? JSON.parse(row.session_json)
        : row.session_json) as TSession & Partial<{
          topic: string;
          agents: string[];
          queue: unknown[];
          firedRules: string[];
        }>;
      return {
        id: session.id,
        topic: session.topic ?? "",
        agents: Array.isArray(session.agents) ? session.agents : [],
        queueLength: Array.isArray(session.queue) ? session.queue.length : 0,
        historyCount: Array.isArray(session.history) ? session.history.length : 0,
        firedRuleCount: Array.isArray(session.firedRules) ? session.firedRules.length : 0
      };
    });
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await this.ensureSchemaWithClient(client);
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }

  private async ensureSchemaWithClient(client: PoolClient): Promise<void> {
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS orchestration_sessions(",
        "  id text PRIMARY KEY,",
        "  session_json jsonb NOT NULL,",
        "  history_count integer NOT NULL DEFAULT 0,",
        "  updated_at timestamptz NOT NULL DEFAULT NOW()",
        ")"
      ].join("\n")
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_orchestration_sessions_updated_at ON orchestration_sessions(updated_at DESC)"
    );
  }
}
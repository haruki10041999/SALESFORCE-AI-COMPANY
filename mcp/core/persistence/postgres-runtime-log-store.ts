import { Pool, type PoolClient } from "pg";

export interface PostgresRuntimeLogStoreOptions {
  databaseUrl: string;
}

export interface RuntimeAuditLogRecord {
  id: string;
  eventType: string;
  resourceType: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeSystemEventRecord {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeTraceRecord {
  traceId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
  metadata: Record<string, unknown>;
  phases?: unknown[];
}

export interface RuntimeExecutionOriginRecord {
  id: string;
  timestamp: string;
  toolName: string;
  status: "success" | "error";
  serverRoot: string;
  processCwd: string;
  repoRoots: string[];
  inputPathHints: string[];
}

export class PostgresRuntimeLogStore {
  private readonly pool: Pool;
  private schemaReady = false;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  public static async open(options: PostgresRuntimeLogStoreOptions): Promise<PostgresRuntimeLogStore> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PostgresRuntimeLogStore");
    }

    const pool = new Pool({ connectionString: options.databaseUrl });
    const store = new PostgresRuntimeLogStore(pool);
    await store.ensureSchema();
    return store;
  }

  public async appendAuditLog(eventType: string, resourceType: string | null, details: Record<string, unknown>, timestamp: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO audit_logs(id, event_type, resource_type, details, timestamp)",
        "VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)"
      ].join("\n"),
      [this.createId(), eventType, resourceType, JSON.stringify(details), timestamp]
    );
  }

  public async listAuditLogs(limit = 200, eventType?: string): Promise<RuntimeAuditLogRecord[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [];
    const where: string[] = [];
    if (eventType) {
      params.push(eventType);
      where.push(`event_type = $${params.length}`);
    }
    params.push(limit);
    const result = await this.pool.query<{
      id: string;
      event_type: string;
      resource_type: string | null;
      details: unknown;
      timestamp: Date | string;
    }>(
      [
        "SELECT id, event_type, resource_type, details, timestamp",
        "FROM audit_logs",
        where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
        "ORDER BY timestamp DESC",
        `LIMIT $${params.length}`
      ].filter(Boolean).join("\n"),
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      resourceType: row.resource_type,
      details: this.toRecord(row.details),
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)
    }));
  }

  public async appendSystemEvent(id: string, event: string, payload: Record<string, unknown>, timestamp: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO system_events(id, event_name, payload, timestamp)",
        "VALUES ($1, $2, $3::jsonb, $4::timestamptz)"
      ].join("\n"),
      [id, event, JSON.stringify(payload), timestamp]
    );
  }

  public async listSystemEvents(limit = 50, event?: string): Promise<RuntimeSystemEventRecord[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [];
    const where: string[] = [];
    if (event) {
      params.push(event);
      where.push(`event_name = $${params.length}`);
    }
    params.push(limit);
    const result = await this.pool.query<{
      id: string;
      event_name: string;
      payload: unknown;
      timestamp: Date | string;
    }>(
      [
        "SELECT id, event_name, payload, timestamp",
        "FROM system_events",
        where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
        "ORDER BY timestamp DESC",
        `LIMIT $${params.length}`
      ].filter(Boolean).join("\n"),
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      event: row.event_name,
      payload: this.toRecord(row.payload),
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)
    }));
  }

  public async upsertTrace(record: RuntimeTraceRecord): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO trace_logs(trace_id, tool_name, started_at, ended_at, duration_ms, status, error_message, metadata, phases, payload)",
        "VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)",
        "ON CONFLICT (trace_id) DO UPDATE SET",
        "  tool_name = EXCLUDED.tool_name,",
        "  started_at = EXCLUDED.started_at,",
        "  ended_at = EXCLUDED.ended_at,",
        "  duration_ms = EXCLUDED.duration_ms,",
        "  status = EXCLUDED.status,",
        "  error_message = EXCLUDED.error_message,",
        "  metadata = EXCLUDED.metadata,",
        "  phases = EXCLUDED.phases,",
        "  payload = EXCLUDED.payload"
      ].join("\n"),
      [
        record.traceId,
        record.toolName,
        record.startedAt,
        record.endedAt ?? null,
        record.durationMs ?? null,
        record.status,
        record.errorMessage ?? null,
        JSON.stringify(record.metadata ?? {}),
        JSON.stringify(record.phases ?? []),
        JSON.stringify(record)
      ]
    );
  }

  public async listTraces(limit = 500): Promise<RuntimeTraceRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM trace_logs",
      "ORDER BY started_at DESC",
      "LIMIT $1"
    ].join("\n"), [limit]);
    return result.rows
      .map((row) => this.toTraceRecord(row.payload))
      .filter((row): row is RuntimeTraceRecord => row !== null)
      .reverse();
  }

  public async appendExecutionOrigin(record: Omit<RuntimeExecutionOriginRecord, "id">): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO execution_origins(id, timestamp, tool_name, status, server_root, process_cwd, repo_roots, input_path_hints, payload)",
        "VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)"
      ].join("\n"),
      [
        this.createId(),
        record.timestamp,
        record.toolName,
        record.status,
        record.serverRoot,
        record.processCwd,
        JSON.stringify(record.repoRoots),
        JSON.stringify(record.inputPathHints),
        JSON.stringify(record)
      ]
    );
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
        "CREATE TABLE IF NOT EXISTS audit_logs(",
        "  id text PRIMARY KEY,",
        "  event_type text NOT NULL,",
        "  resource_type text,",
        "  details jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  timestamp timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type_timestamp ON audit_logs(event_type, timestamp DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS system_events(",
        "  id text PRIMARY KEY,",
        "  event_name text NOT NULL,",
        "  payload jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  timestamp timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_events_event_name_timestamp ON system_events(event_name, timestamp DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS trace_logs(",
        "  trace_id text PRIMARY KEY,",
        "  tool_name text NOT NULL,",
        "  started_at timestamptz NOT NULL,",
        "  ended_at timestamptz,",
        "  duration_ms integer,",
        "  status text NOT NULL,",
        "  error_message text,",
        "  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  phases jsonb NOT NULL DEFAULT '[]'::jsonb,",
        "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_trace_logs_started_at ON trace_logs(started_at DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS execution_origins(",
        "  id text PRIMARY KEY,",
        "  timestamp timestamptz NOT NULL,",
        "  tool_name text NOT NULL,",
        "  status text NOT NULL,",
        "  server_root text NOT NULL,",
        "  process_cwd text NOT NULL,",
        "  repo_roots jsonb NOT NULL DEFAULT '[]'::jsonb,",
        "  input_path_hints jsonb NOT NULL DEFAULT '[]'::jsonb,",
        "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_execution_origins_timestamp ON execution_origins(timestamp DESC)");
  }

  private createId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toTraceRecord(value: unknown): RuntimeTraceRecord | null {
    const record = this.toRecord(value);
    if (
      typeof record.traceId !== "string" ||
      typeof record.toolName !== "string" ||
      typeof record.startedAt !== "string" ||
      (record.status !== "running" && record.status !== "success" && record.status !== "error")
    ) {
      return null;
    }
    return {
      traceId: record.traceId,
      toolName: record.toolName,
      startedAt: record.startedAt,
      endedAt: typeof record.endedAt === "string" ? record.endedAt : undefined,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
      status: record.status,
      errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : undefined,
      metadata: this.toRecord(record.metadata),
      phases: Array.isArray(record.phases) ? record.phases : undefined
    };
  }
}
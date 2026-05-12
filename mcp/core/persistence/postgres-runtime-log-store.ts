import { Pool, type PoolClient } from "pg";
import { currentTenantId } from "../identity/tenant-context.js";
import { ensureTenantRlsPolicy, withTenantScopedClient } from "./postgres-tenant-context.js";
import { getOrCreatePgPool, releasePgPoolKey } from "./pg-pool-registry.js";

export interface PostgresRuntimeLogStoreOptions {
  databaseUrl: string;
}

export interface RuntimeAuditLogRecord {
  id: string;
  tenantId?: string;
  eventType: string;
  resourceType: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeSystemEventRecord {
  id: string;
  tenantId?: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeTraceRecord {
  traceId: string;
  tenantId?: string;
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

export interface RuntimeToolExecutionRecord {
  id: string;
  tenantId?: string;
  ts: string;
  sessionId?: string;
  toolName: string;
  argsHash: string;
  argsJson: Record<string, unknown>;
  outputHash?: string;
  outputJson: Record<string, unknown>;
  durationMs?: number;
  status: "success" | "error";
  recordedAt: string;
}

export class PostgresRuntimeLogStore {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private schemaReady = false;

  private constructor(pool: Pool, poolKey: string) {
    this.pool = pool;
    this.poolKey = poolKey;
  }

  public static async open(options: PostgresRuntimeLogStoreOptions): Promise<PostgresRuntimeLogStore> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PostgresRuntimeLogStore");
    }

    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `runtime-log-store.postgres:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const pool = getOrCreatePgPool(poolKey, normalizedUrl);
    const store = new PostgresRuntimeLogStore(pool, poolKey);
    await store.ensureSchema();
    return store;
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  public async appendAuditLog(eventType: string, resourceType: string | null, details: Record<string, unknown>, timestamp: string): Promise<void> {
    await this.ensureSchema();
    const tenantId = currentTenantId() ?? null;
    await this.withTenantClient(
      (client) => client.query(
        [
          "INSERT INTO audit_logs(id, tenant_id, event_type, resource_type, details, timestamp)",
          "VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)"
        ].join("\n"),
        [this.createId(), tenantId, eventType, resourceType, JSON.stringify(details), timestamp]
      ),
      tenantId ?? undefined
    );
  }

  public async listAuditLogs(limit = 200, eventType?: string): Promise<RuntimeAuditLogRecord[]> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const params: Array<string | number> = [];
    const where: string[] = [];
    if (tenantId) {
      params.push(tenantId);
      where.push(`tenant_id = $${params.length}`);
    } else {
      where.push("tenant_id IS NULL");
    }
    if (eventType) {
      params.push(eventType);
      where.push(`event_type = $${params.length}`);
    }
    params.push(limit);
    const result = await this.withTenantClient(
      (client) => client.query<{
        id: string;
        tenant_id: string | null;
        event_type: string;
        resource_type: string | null;
        details: unknown;
        timestamp: Date | string;
      }>(
        [
          "SELECT id, tenant_id, event_type, resource_type, details, timestamp",
          "FROM audit_logs",
          where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
          "ORDER BY timestamp DESC",
          `LIMIT $${params.length}`
        ].filter(Boolean).join("\n"),
        params
      ),
      tenantId
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      eventType: row.event_type,
      resourceType: row.resource_type,
      details: this.toRecord(row.details),
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)
    }));
  }

  public async appendSystemEvent(id: string, event: string, payload: Record<string, unknown>, timestamp: string): Promise<void> {
    await this.ensureSchema();
    const tenantId = currentTenantId() ?? null;
    await this.withTenantClient(
      (client) => client.query(
        [
          "INSERT INTO system_events(id, tenant_id, event_name, payload, timestamp)",
          "VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)"
        ].join("\n"),
        [id, tenantId, event, JSON.stringify(payload), timestamp]
      ),
      tenantId ?? undefined
    );
  }

  public async listSystemEvents(limit = 50, event?: string): Promise<RuntimeSystemEventRecord[]> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const params: Array<string | number> = [];
    const where: string[] = [];
    if (tenantId) {
      params.push(tenantId);
      where.push(`tenant_id = $${params.length}`);
    } else {
      where.push("tenant_id IS NULL");
    }
    if (event) {
      params.push(event);
      where.push(`event_name = $${params.length}`);
    }
    params.push(limit);
    const result = await this.withTenantClient(
      (client) => client.query<{
        id: string;
        tenant_id: string | null;
        event_name: string;
        payload: unknown;
        timestamp: Date | string;
      }>(
        [
          "SELECT id, tenant_id, event_name, payload, timestamp",
          "FROM system_events",
          where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
          "ORDER BY timestamp DESC",
          `LIMIT $${params.length}`
        ].filter(Boolean).join("\n"),
        params
      ),
      tenantId
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      event: row.event_name,
      payload: this.toRecord(row.payload),
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)
    }));
  }

  public async upsertTrace(record: RuntimeTraceRecord): Promise<void> {
    await this.ensureSchema();
    const tenantId = record.tenantId ?? currentTenantId() ?? null;
    await this.withTenantClient(
      (client) => client.query(
        [
          "INSERT INTO trace_logs(trace_id, tenant_id, tool_name, started_at, ended_at, duration_ms, status, error_message, metadata, phases, payload)",
          "VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)",
          "ON CONFLICT (trace_id) DO UPDATE SET",
          "  tenant_id = EXCLUDED.tenant_id,",
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
          tenantId,
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
      ),
      tenantId ?? undefined
    );
  }

  public async listTraces(limit = 500): Promise<RuntimeTraceRecord[]> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await this.withTenantClient(
      (client) => client.query<{ payload: unknown }>(
        [
          "SELECT payload",
          tenantId
            ? "FROM trace_logs WHERE tenant_id = $2"
            : "FROM trace_logs WHERE tenant_id IS NULL",
          "ORDER BY started_at DESC",
          "LIMIT $1"
        ].join("\n"),
        tenantId ? [limit, tenantId] : [limit]
      ),
      tenantId
    );
    return result.rows
      .map((row) => this.toTraceRecord(row.payload))
      .filter((row): row is RuntimeTraceRecord => row !== null)
      .reverse();
  }

  public async appendExecutionOrigin(record: Omit<RuntimeExecutionOriginRecord, "id">): Promise<void> {
    await this.ensureSchema();
    await this.withTenantClient((client) => client.query(
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
    ));
  }

  public async upsertToolExecution(record: RuntimeToolExecutionRecord): Promise<void> {
    await this.ensureSchema();
    await this.withTenantClient(
      (client) => client.query(
        [
          "INSERT INTO tool_executions(id, tenant_id, ts, session_id, tool_name, args_hash, args_json, output_hash, output_json, duration_ms, status, recorded_at)",
          "VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12::timestamptz)",
          "ON CONFLICT (id) DO UPDATE SET",
          "  tenant_id = EXCLUDED.tenant_id,",
          "  ts = EXCLUDED.ts,",
          "  session_id = EXCLUDED.session_id,",
          "  tool_name = EXCLUDED.tool_name,",
          "  args_hash = EXCLUDED.args_hash,",
          "  args_json = EXCLUDED.args_json,",
          "  output_hash = EXCLUDED.output_hash,",
          "  output_json = EXCLUDED.output_json,",
          "  duration_ms = EXCLUDED.duration_ms,",
          "  status = EXCLUDED.status,",
          "  recorded_at = EXCLUDED.recorded_at"
        ].join("\n"),
        [
          record.id,
          record.tenantId ?? null,
          record.ts,
          record.sessionId ?? null,
          record.toolName,
          record.argsHash,
          JSON.stringify(record.argsJson),
          record.outputHash ?? null,
          JSON.stringify(record.outputJson),
          record.durationMs ?? null,
          record.status,
          record.recordedAt
        ]
      ),
      record.tenantId
    );
  }

  public async findToolExecution(toolName: string, argsHash: string, tenantId?: string): Promise<RuntimeToolExecutionRecord | null> {
    await this.ensureSchema();
    const effectiveTenantId = tenantId ?? currentTenantId();
    const result = await this.withTenantClient(
      (client) => client.query<{
        id: string;
        tenant_id: string | null;
        ts: Date | string;
        session_id: string | null;
        tool_name: string;
        args_hash: string;
        args_json: unknown;
        output_hash: string | null;
        output_json: unknown;
        duration_ms: number | null;
        status: "success" | "error";
        recorded_at: Date | string;
      }>(
        [
          "SELECT id, tenant_id, ts, session_id, tool_name, args_hash, args_json, output_hash, output_json, duration_ms, status, recorded_at",
          effectiveTenantId
            ? "FROM tool_executions WHERE tool_name = $1 AND args_hash = $2 AND tenant_id = $3"
            : "FROM tool_executions WHERE tool_name = $1 AND args_hash = $2 AND tenant_id IS NULL",
          "ORDER BY recorded_at DESC LIMIT 1"
        ].join("\n"),
        effectiveTenantId ? [toolName, argsHash, effectiveTenantId] : [toolName, argsHash]
      ),
      effectiveTenantId
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
      sessionId: row.session_id ?? undefined,
      toolName: row.tool_name,
      argsHash: row.args_hash,
      argsJson: this.toRecord(row.args_json),
      outputHash: row.output_hash ?? undefined,
      outputJson: this.toRecord(row.output_json),
      durationMs: row.duration_ms ?? undefined,
      status: row.status,
      recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at)
    };
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
        "  tenant_id text,",
        "  event_type text NOT NULL,",
        "  resource_type text,",
        "  details jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  timestamp timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id text");
    await client.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type_timestamp ON audit_logs(event_type, timestamp DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_event_type_timestamp ON audit_logs(tenant_id, event_type, timestamp DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS system_events(",
        "  id text PRIMARY KEY,",
        "  tenant_id text,",
        "  event_name text NOT NULL,",
        "  payload jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  timestamp timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query("ALTER TABLE system_events ADD COLUMN IF NOT EXISTS tenant_id text");
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_events_event_name_timestamp ON system_events(event_name, timestamp DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_events_tenant_event_name_timestamp ON system_events(tenant_id, event_name, timestamp DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS trace_logs(",
        "  trace_id text PRIMARY KEY,",
        "  tenant_id text,",
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
    await client.query("ALTER TABLE trace_logs ADD COLUMN IF NOT EXISTS tenant_id text");
    await client.query("CREATE INDEX IF NOT EXISTS idx_trace_logs_started_at ON trace_logs(started_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_trace_logs_tenant_started_at ON trace_logs(tenant_id, started_at DESC)");
    await client.query(
      [
        "CREATE TABLE IF NOT EXISTS tool_executions(",
        "  id text PRIMARY KEY,",
        "  tenant_id text,",
        "  ts timestamptz NOT NULL,",
        "  session_id text,",
        "  tool_name text NOT NULL,",
        "  args_hash text NOT NULL,",
        "  args_json jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  output_hash text,",
        "  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  duration_ms integer,",
        "  status text NOT NULL,",
        "  recorded_at timestamptz NOT NULL",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_args ON tool_executions(tool_name, args_hash, recorded_at DESC)");
    await client.query("ALTER TABLE tool_executions ADD COLUMN IF NOT EXISTS tenant_id text");
    await client.query("CREATE INDEX IF NOT EXISTS idx_tool_executions_tenant_tool_args ON tool_executions(tenant_id, tool_name, args_hash, recorded_at DESC)");
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
    await ensureTenantRlsPolicy(client, "audit_logs", "audit_logs_tenant_isolation");
    await ensureTenantRlsPolicy(client, "system_events", "system_events_tenant_isolation");
    await ensureTenantRlsPolicy(client, "trace_logs", "trace_logs_tenant_isolation");
    await ensureTenantRlsPolicy(client, "tool_executions", "tool_executions_tenant_isolation");
  }

  private async withTenantClient<T>(work: (client: PoolClient) => Promise<T>, tenantId?: string): Promise<T> {
    return withTenantScopedClient(this.pool, work, tenantId);
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
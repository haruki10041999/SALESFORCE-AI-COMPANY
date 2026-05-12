import { createHash } from "node:crypto";
import { Pool } from "pg";
import { currentTenantId } from "../identity/tenant-context.js";
import { getOrCreatePgPool, releasePgPoolKey } from "../persistence/pg-pool-registry.js";

export type OrchestrationStepStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface OrchestrationStepRecord {
  sessionId: string;
  stepIndex: number;
  agent: string;
  status: OrchestrationStepStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  inputHash?: string;
  outputHash?: string;
  errorJson?: Record<string, unknown> | null;
  checkpointJson?: Record<string, unknown> | null;
}

export interface OrchestrationJobRunner {
  readonly backend: "in-memory" | "postgres";
  enqueueStep(input: {
    sessionId: string;
    stepIndex: number;
    agent: string;
    payload?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord>;
  markDequeued(sessionId: string, agent: string): Promise<OrchestrationStepRecord | null>;
  completeLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    output?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null>;
  failLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    error: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null>;
  listSteps(sessionId: string): Promise<OrchestrationStepRecord[]>;
  close(): Promise<void>;
}

function hashValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return createHash("sha256").update(JSON.stringify(value), "utf-8").digest("hex");
}

class InMemoryOrchestrationJobRunner implements OrchestrationJobRunner {
  public readonly backend = "in-memory" as const;
  private readonly steps = new Map<string, OrchestrationStepRecord[]>();

  private key(sessionId: string): string {
    const tenant = currentTenantId() ?? "__global";
    return `${tenant}:${sessionId}`;
  }

  public async enqueueStep(input: {
    sessionId: string;
    stepIndex: number;
    agent: string;
    payload?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord> {
    const existing = await this.findStep(input.sessionId, input.stepIndex);
    if (existing) {
      return existing;
    }
    const record: OrchestrationStepRecord = {
      sessionId: input.sessionId,
      stepIndex: input.stepIndex,
      agent: input.agent,
      status: "queued",
      attempt: 0,
      inputHash: hashValue(input.payload),
      checkpointJson: input.checkpoint ?? null
    };
    const key = this.key(input.sessionId);
    const rows = this.steps.get(key) ?? [];
    rows.push(record);
    rows.sort((a, b) => a.stepIndex - b.stepIndex);
    this.steps.set(key, rows);
    return record;
  }

  public async markDequeued(sessionId: string, agent: string): Promise<OrchestrationStepRecord | null> {
    const row = (this.steps.get(this.key(sessionId)) ?? []).find((step) => step.agent === agent && step.status === "queued");
    if (!row) {
      return null;
    }
    row.status = "running";
    row.attempt += 1;
    row.startedAt = new Date().toISOString();
    return row;
  }

  public async completeLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    output?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null> {
    const rows = this.steps.get(this.key(input.sessionId)) ?? [];
    const row = [...rows]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === input.agent && step.status === "running");
    if (!row) {
      return null;
    }
    row.status = "completed";
    row.finishedAt = new Date().toISOString();
    row.outputHash = hashValue(input.output);
    row.checkpointJson = input.checkpoint ?? row.checkpointJson ?? null;
    return row;
  }

  public async failLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    error: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null> {
    const rows = this.steps.get(this.key(input.sessionId)) ?? [];
    const row = [...rows]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === input.agent && step.status === "running");
    if (!row) {
      return null;
    }
    row.status = "failed";
    row.finishedAt = new Date().toISOString();
    row.errorJson = { message: errorToMessage(input.error) };
    row.checkpointJson = input.checkpoint ?? row.checkpointJson ?? null;
    return row;
  }

  public async listSteps(sessionId: string): Promise<OrchestrationStepRecord[]> {
    return [...(this.steps.get(this.key(sessionId)) ?? [])].sort((a, b) => a.stepIndex - b.stepIndex);
  }

  public async close(): Promise<void> {
    this.steps.clear();
  }

  private async findStep(sessionId: string, stepIndex: number): Promise<OrchestrationStepRecord | undefined> {
    return (this.steps.get(this.key(sessionId)) ?? []).find((step) => step.stepIndex === stepIndex);
  }
}

class PostgresOrchestrationJobRunner implements OrchestrationJobRunner {
  public readonly backend = "postgres" as const;
  private readonly pool: Pool;
  private readonly poolKey: string;
  private schemaReady = false;

  public constructor(databaseUrl: string) {
    const normalizedUrl = databaseUrl.trim();
    this.poolKey = `orchestration-job-runner:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.pool = getOrCreatePgPool(this.poolKey, normalizedUrl);
  }

  public async enqueueStep(input: {
    sessionId: string;
    stepIndex: number;
    agent: string;
    payload?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord> {
    await this.ensureSchema();
    const tenantId = currentTenantId() ?? null;
    await this.pool.query(
      [
        "INSERT INTO orchestration_steps(tenant_id, session_id, step_index, agent, status, attempt, input_hash, checkpoint_json)",
        "VALUES ($1, $2, $3, $4, 'queued'::orchestration_step_status, 0, $5, $6::jsonb)",
        "ON CONFLICT (session_id, step_index) DO NOTHING"
      ].join("\n"),
      [tenantId, input.sessionId, input.stepIndex, input.agent, hashValue(input.payload) ?? null, JSON.stringify(input.checkpoint ?? null)]
    );
    return (await this.listSteps(input.sessionId)).find((step) => step.stepIndex === input.stepIndex)!;
  }

  public async markDequeued(sessionId: string, agent: string): Promise<OrchestrationStepRecord | null> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await this.pool.query(
      [
        "UPDATE orchestration_steps",
        "SET status = 'running'::orchestration_step_status, attempt = attempt + 1, started_at = NOW()",
        "WHERE (session_id, step_index) IN (",
        "  SELECT session_id, step_index FROM orchestration_steps",
        tenantId
          ? "  WHERE session_id = $1 AND agent = $2 AND status = 'queued'::orchestration_step_status AND tenant_id = $3"
          : "  WHERE session_id = $1 AND agent = $2 AND status = 'queued'::orchestration_step_status AND tenant_id IS NULL",
        "  ORDER BY step_index ASC LIMIT 1",
        ")",
        "RETURNING session_id, step_index, agent, status, attempt, started_at, finished_at, input_hash, output_hash, error_json, checkpoint_json"
      ].join("\n"),
      tenantId ? [sessionId, agent, tenantId] : [sessionId, agent]
    );
    return result.rows[0] ? mapStepRow(result.rows[0]) : null;
  }

  public async completeLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    output?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await this.pool.query(
      [
        "UPDATE orchestration_steps",
        "SET status = 'completed'::orchestration_step_status, finished_at = NOW(), output_hash = $3, checkpoint_json = $4::jsonb",
        "WHERE (session_id, step_index) IN (",
        "  SELECT session_id, step_index FROM orchestration_steps",
        tenantId
          ? "  WHERE session_id = $1 AND agent = $2 AND status = 'running'::orchestration_step_status AND tenant_id = $5"
          : "  WHERE session_id = $1 AND agent = $2 AND status = 'running'::orchestration_step_status AND tenant_id IS NULL",
        "  ORDER BY step_index DESC LIMIT 1",
        ")",
        "RETURNING session_id, step_index, agent, status, attempt, started_at, finished_at, input_hash, output_hash, error_json, checkpoint_json"
      ].join("\n"),
      tenantId
        ? [input.sessionId, input.agent, hashValue(input.output) ?? null, JSON.stringify(input.checkpoint ?? null), tenantId]
        : [input.sessionId, input.agent, hashValue(input.output) ?? null, JSON.stringify(input.checkpoint ?? null)]
    );
    return result.rows[0] ? mapStepRow(result.rows[0]) : null;
  }

  public async failLatestRunningStep(input: {
    sessionId: string;
    agent: string;
    error: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<OrchestrationStepRecord | null> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await this.pool.query(
      [
        "UPDATE orchestration_steps",
        "SET status = 'failed'::orchestration_step_status, finished_at = NOW(), error_json = $3::jsonb, checkpoint_json = $4::jsonb",
        "WHERE (session_id, step_index) IN (",
        "  SELECT session_id, step_index FROM orchestration_steps",
        tenantId
          ? "  WHERE session_id = $1 AND agent = $2 AND status = 'running'::orchestration_step_status AND tenant_id = $5"
          : "  WHERE session_id = $1 AND agent = $2 AND status = 'running'::orchestration_step_status AND tenant_id IS NULL",
        "  ORDER BY step_index DESC LIMIT 1",
        ")",
        "RETURNING session_id, step_index, agent, status, attempt, started_at, finished_at, input_hash, output_hash, error_json, checkpoint_json"
      ].join("\n"),
      tenantId
        ? [input.sessionId, input.agent, JSON.stringify({ message: errorToMessage(input.error) }), JSON.stringify(input.checkpoint ?? null), tenantId]
        : [input.sessionId, input.agent, JSON.stringify({ message: errorToMessage(input.error) }), JSON.stringify(input.checkpoint ?? null)]
    );
    return result.rows[0] ? mapStepRow(result.rows[0]) : null;
  }

  public async listSteps(sessionId: string): Promise<OrchestrationStepRecord[]> {
    await this.ensureSchema();
    const tenantId = currentTenantId();
    const result = await this.pool.query(
      [
        "SELECT session_id, step_index, agent, status, attempt, started_at, finished_at, input_hash, output_hash, error_json, checkpoint_json",
        tenantId
          ? "FROM orchestration_steps WHERE session_id = $1 AND tenant_id = $2 ORDER BY step_index ASC"
          : "FROM orchestration_steps WHERE session_id = $1 AND tenant_id IS NULL ORDER BY step_index ASC"
      ].join("\n"),
      tenantId ? [sessionId, tenantId] : [sessionId]
    );
    return result.rows.map((row) => mapStepRow(row));
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query(`
        DO $$ BEGIN
          CREATE TYPE orchestration_step_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS orchestration_steps (
          tenant_id text,
          session_id text NOT NULL,
          step_index integer NOT NULL,
          agent text NOT NULL,
          status orchestration_step_status NOT NULL DEFAULT 'queued',
          attempt integer NOT NULL DEFAULT 0,
          started_at timestamptz,
          finished_at timestamptz,
          input_hash text,
          output_hash text,
          error_json jsonb,
          checkpoint_json jsonb,
          PRIMARY KEY(session_id, step_index)
        )
      `);
      await client.query("ALTER TABLE orchestration_steps ADD COLUMN IF NOT EXISTS tenant_id text");
      await client.query("CREATE INDEX IF NOT EXISTS idx_orchestration_steps_session_status ON orchestration_steps(session_id, status)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_orchestration_steps_tenant_session_status ON orchestration_steps(tenant_id, session_id, status)");
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapStepRow(row: Record<string, unknown>): OrchestrationStepRecord {
  return {
    sessionId: String(row.session_id),
    stepIndex: Number(row.step_index),
    agent: String(row.agent),
    status: row.status as OrchestrationStepStatus,
    attempt: Number(row.attempt ?? 0),
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : (row.started_at ? String(row.started_at) : undefined),
    finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : (row.finished_at ? String(row.finished_at) : undefined),
    inputHash: row.input_hash ? String(row.input_hash) : undefined,
    outputHash: row.output_hash ? String(row.output_hash) : undefined,
    errorJson: (row.error_json as Record<string, unknown> | null | undefined) ?? undefined,
    checkpointJson: (row.checkpoint_json as Record<string, unknown> | null | undefined) ?? undefined
  };
}

export function createOrchestrationJobRunner(options: {
  stateBackend?: string;
  databaseUrl?: string;
}): OrchestrationJobRunner {
  if (options.stateBackend === "postgres" && options.databaseUrl) {
    return new PostgresOrchestrationJobRunner(options.databaseUrl);
  }
  return new InMemoryOrchestrationJobRunner();
}
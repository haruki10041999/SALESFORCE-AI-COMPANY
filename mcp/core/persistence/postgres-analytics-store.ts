import { Pool, type PoolClient } from "pg";
import type { ToolMetricSample } from "../../tools/metrics.js";
import type { UserFeedback, RewardRecord } from "../types/feedback.js";
import type { CleanupSchedule, CleanupSchedulesFile } from "../resource/cleanup-scheduler.js";
import type { ProposalFeedbackEntry, ProposalFeedbackModel } from "../resource/proposal-feedback.js";
import type { QuerySkillFeedbackEntry, QuerySkillIncrementalModel } from "../resource/query-skill-incremental.js";
import type { AgentReputationRecord } from "../learning/agent-reputation.js";
import type { AgentSynergyRecord } from "../learning/agent-synergy.js";
import type { AgentGraphRecord } from "../learning/agent-graph-learner.js";
import type { OutputRatioFeedbackEntry } from "../learning/cost-feedback.js";
import type { DriftReport } from "../learning/drift-detector.js";
import type { FailureMemoryEntry } from "../../../memory/failure-memory.js";

export interface PostgresAnalyticsStoreOptions {
  databaseUrl: string;
}

export class PostgresAnalyticsStore {
  private readonly pool: Pool;
  private schemaReady = false;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  public static async open(options: PostgresAnalyticsStoreOptions): Promise<PostgresAnalyticsStore> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PostgresAnalyticsStore");
    }
    const pool = new Pool({ connectionString: options.databaseUrl });
    const store = new PostgresAnalyticsStore(pool);
    await store.ensureSchema();
    return store;
  }

  public async loadCleanupSchedules(): Promise<CleanupSchedulesFile> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      id: string;
      name: string;
      cron: string;
      action: "dry-run" | "apply";
      status: "active" | "paused";
      days_unused: number;
      limit_count: number;
      require_approval: boolean;
      created_at: Date | string;
      updated_at: Date | string;
      last_run_at: Date | string | null;
    }>([
      "SELECT id, name, cron, action, status, days_unused, limit_count, require_approval, created_at, updated_at, last_run_at",
      "FROM cleanup_schedules",
      "ORDER BY created_at ASC"
    ].join("\n"));

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      schedules: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        cron: row.cron,
        action: row.action,
        status: row.status,
        daysUnused: row.days_unused,
        limit: row.limit_count,
        requireApproval: row.require_approval,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        lastRunAt: row.last_run_at ? (row.last_run_at instanceof Date ? row.last_run_at.toISOString() : String(row.last_run_at)) : undefined
      }))
    };
  }

  public async saveCleanupSchedules(data: CleanupSchedulesFile): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM cleanup_schedules");
      for (const schedule of data.schedules) {
        await client.query([
          "INSERT INTO cleanup_schedules(id, name, cron, action, status, days_unused, limit_count, require_approval, created_at, updated_at, last_run_at)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)"
        ].join("\n"), [
          schedule.id,
          schedule.name,
          schedule.cron,
          schedule.action,
          schedule.status,
          schedule.daysUnused,
          schedule.limit,
          schedule.requireApproval,
          schedule.createdAt,
          schedule.updatedAt,
          schedule.lastRunAt ?? null
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async appendMetric(sample: ToolMetricSample): Promise<void> {
    await this.ensureSchema();
    await this.pool.query([
      "INSERT INTO metrics_samples(id, tool_name, trace_id, started_at, duration_ms, status, cache_hit, payload)",
      "VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8::jsonb)"
    ].join("\n"), [
      this.createId(),
      sample.toolName,
      sample.traceId ?? null,
      sample.startedAt,
      sample.durationMs,
      sample.status,
      sample.cacheHit === true,
      JSON.stringify(sample)
    ]);
  }

  public async listMetrics(limit: number): Promise<ToolMetricSample[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      payload: unknown;
    }>([
      "SELECT payload",
      "FROM metrics_samples",
      "ORDER BY started_at DESC",
      "LIMIT $1"
    ].join("\n"), [limit]);
    return result.rows
      .map((row) => this.asRecord(row.payload))
      .map((payload) => ({
        toolName: typeof payload.toolName === "string" ? payload.toolName : "unknown",
        traceId: typeof payload.traceId === "string" ? payload.traceId : undefined,
        startedAt: typeof payload.startedAt === "string" ? payload.startedAt : new Date().toISOString(),
        durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
        status: (payload.status === "error" ? "error" : "success") as "error" | "success",
        cacheHit: payload.cacheHit === true
      }))
      .reverse();
  }

  public async clearMetrics(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("DELETE FROM metrics_samples");
  }

  public async insertFeedback(record: UserFeedback): Promise<void> {
    await this.ensureSchema();
    await this.pool.query([
      "INSERT INTO feedback_records(feedback_id, session_id, agent_name, rating, comment, timestamp, quality_score, tags_json, user_id, payload)",
      "VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb, $9, $10::jsonb)"
    ].join("\n"), [
      record.feedbackId,
      record.sessionId,
      record.agentName ?? null,
      record.rating,
      record.comment ?? null,
      record.timestamp,
      record.qualityScore ?? null,
      JSON.stringify(record.tags ?? []),
      record.userId ?? null,
      JSON.stringify(record)
    ]);
  }

  public async listFeedback(): Promise<UserFeedback[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM feedback_records",
      "ORDER BY timestamp ASC"
    ].join("\n"));
    return result.rows.map((row) => this.asUserFeedback(row.payload)).filter((row): row is UserFeedback => row !== null);
  }

  public async insertReward(record: RewardRecord): Promise<void> {
    await this.ensureSchema();
    await this.pool.query([
      "INSERT INTO reward_records(reward_id, source, session_id, agent_name, tool_name, reward, confidence, raw_metric, reason, timestamp, tags_json, payload)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz, $11::jsonb, $12::jsonb)"
    ].join("\n"), [
      record.rewardId,
      record.source,
      record.sessionId ?? null,
      record.agentName ?? null,
      record.toolName ?? null,
      record.reward,
      record.confidence ?? null,
      JSON.stringify(record.rawMetric ?? {}),
      record.reason ?? null,
      record.timestamp,
      JSON.stringify(record.tags ?? []),
      JSON.stringify(record)
    ]);
  }

  public async listRewards(): Promise<RewardRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM reward_records",
      "ORDER BY timestamp ASC"
    ].join("\n"));
    return result.rows.map((row) => this.asRewardRecord(row.payload)).filter((row): row is RewardRecord => row !== null);
  }

  public async appendProposalFeedbackEntries(entries: ProposalFeedbackEntry[]): Promise<void> {
    await this.ensureSchema();
    if (entries.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of entries) {
        await client.query(
          [
            "INSERT INTO proposal_feedback_entries(id, resource_type, name, decision, topic, note, recorded_at, payload)",
            "VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)"
          ].join("\n"),
          [
            this.createId(),
            entry.resourceType,
            entry.name,
            entry.decision,
            entry.topic ?? null,
            entry.note ?? null,
            entry.recordedAt,
            JSON.stringify(entry)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listProposalFeedbackEntries(): Promise<ProposalFeedbackEntry[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM proposal_feedback_entries",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asProposalFeedbackEntry(row.payload))
      .filter((row): row is ProposalFeedbackEntry => row !== null);
  }

  public async appendQuerySkillFeedbackEntries(entries: QuerySkillFeedbackEntry[]): Promise<void> {
    await this.ensureSchema();
    if (entries.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of entries) {
        await client.query(
          [
            "INSERT INTO query_skill_feedback_entries(id, query, skill, decision, recorded_at, payload)",
            "VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)"
          ].join("\n"),
          [
            this.createId(),
            entry.query,
            entry.skill,
            entry.decision,
            entry.recordedAt,
            JSON.stringify(entry)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listQuerySkillFeedbackEntries(): Promise<QuerySkillFeedbackEntry[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM query_skill_feedback_entries",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asQuerySkillFeedbackEntry(row.payload))
      .filter((row): row is QuerySkillFeedbackEntry => row !== null);
  }

  public async saveNamedModel(name: string, payload: Record<string, unknown>): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO analytics_models(name, payload, updated_at)",
        "VALUES ($1, $2::jsonb, now())",
        "ON CONFLICT(name) DO UPDATE SET",
        "  payload = EXCLUDED.payload,",
        "  updated_at = EXCLUDED.updated_at"
      ].join("\n"),
      [name, JSON.stringify(payload)]
    );
  }

  public async loadProposalFeedbackModel(): Promise<ProposalFeedbackModel | null> {
    const payload = await this.loadNamedModel("proposal-feedback-model");
    if (!payload || !Array.isArray(payload.resources)) {
      return null;
    }
    return payload as unknown as ProposalFeedbackModel;
  }

  public async loadQuerySkillIncrementalModel(): Promise<QuerySkillIncrementalModel | null> {
    const payload = await this.loadNamedModel("query-skill-model");
    if (!payload || !Array.isArray(payload.skills)) {
      return null;
    }
    return payload as unknown as QuerySkillIncrementalModel;
  }

  public async loadNamedModelPublic(name: string): Promise<Record<string, unknown> | null> {
    return this.loadNamedModel(name);
  }

  public async appendSkillRatingEntries(entries: Array<{
    skill: string;
    rating: number;
    topic?: string;
    note?: string;
    recordedAt: string;
  }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of entries) {
        await client.query(
          [
            "INSERT INTO skill_rating_entries(id, skill, rating, topic, note, recorded_at, payload)",
            "VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)"
          ].join("\n"),
          [
            this.createId(),
            entry.skill,
            entry.rating,
            entry.topic ?? null,
            entry.note ?? null,
            entry.recordedAt,
            JSON.stringify(entry)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listSkillRatingEntries(): Promise<Array<{
    skill: string;
    rating: number;
    topic?: string;
    note?: string;
    recordedAt: string;
  }>> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      skill: string;
      rating: number;
      topic: string | null;
      note: string | null;
      recorded_at: Date | string;
    }>([
      "SELECT skill, rating, topic, note, recorded_at",
      "FROM skill_rating_entries",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows.map((row) => {
      const entry: { skill: string; rating: number; topic?: string; note?: string; recordedAt: string } = {
        skill: row.skill,
        rating: row.rating,
        recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at)
      };
      if (row.topic !== null) entry.topic = row.topic;
      if (row.note !== null) entry.note = row.note;
      return entry;
    });
  }

  public async insertAgentReputationRecord(record: AgentReputationRecord): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO agent_reputation_records(id, timestamp, agent_name, scope, scope_key, delta, score_before, score_after, reason, payload)",
        "VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)"
      ].join("\n"),
      [
        record.id,
        record.timestamp,
        record.agentName,
        record.scope,
        record.scopeKey,
        record.delta,
        record.scoreBefore,
        record.scoreAfter,
        record.reason ?? null,
        JSON.stringify(record)
      ]
    );
  }

  public async listAgentReputationRecords(): Promise<AgentReputationRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM agent_reputation_records",
      "ORDER BY timestamp ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asAgentReputationRecord(row.payload))
      .filter((row): row is AgentReputationRecord => row !== null);
  }

  public async insertAgentSynergyRecord(record: AgentSynergyRecord): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO agent_synergy_records(id, recorded_at, agents_json, quality_score, session_id, persona, success, payload)",
        "VALUES ($1, $2::timestamptz, $3::jsonb, $4, $5, $6, $7, $8::jsonb)"
      ].join("\n"),
      [
        this.createId(),
        record.recordedAt,
        JSON.stringify(record.agents),
        record.qualityScore ?? null,
        record.sessionId ?? null,
        record.persona ?? null,
        record.success ?? null,
        JSON.stringify(record)
      ]
    );
  }

  public async listAgentSynergyRecords(): Promise<AgentSynergyRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM agent_synergy_records",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asAgentSynergyRecord(row.payload))
      .filter((row): row is AgentSynergyRecord => row !== null);
  }

  public async insertAgentGraphRecord(record: AgentGraphRecord): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO agent_graph_records(id, recorded_at, session_id, sequence_json, success, payload)",
        "VALUES ($1, $2::timestamptz, $3, $4::jsonb, $5, $6::jsonb)"
      ].join("\n"),
      [
        this.createId(),
        record.recordedAt,
        record.sessionId ?? null,
        JSON.stringify(record.sequence),
        record.success,
        JSON.stringify(record)
      ]
    );
  }

  public async listAgentGraphRecords(): Promise<AgentGraphRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM agent_graph_records",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asAgentGraphRecord(row.payload))
      .filter((row): row is AgentGraphRecord => row !== null);
  }

  public async insertOutputRatioFeedback(record: OutputRatioFeedbackEntry): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO output_ratio_feedback(id, recorded_at, model, agent, input_tokens, output_tokens, output_ratio, trace_id, payload)",
        "VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9::jsonb)"
      ].join("\n"),
      [
        this.createId(),
        record.recordedAt,
        record.model,
        record.agent,
        record.inputTokens,
        record.outputTokens,
        record.outputRatio,
        record.traceId ?? null,
        JSON.stringify(record)
      ]
    );
  }

  public async listOutputRatioFeedback(): Promise<OutputRatioFeedbackEntry[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM output_ratio_feedback",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asOutputRatioFeedbackEntry(row.payload))
      .filter((row): row is OutputRatioFeedbackEntry => row !== null);
  }

  public async insertDriftReport(report: DriftReport): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO drift_reports(report_id, timestamp, should_alert, alerts_json, payload)",
        "VALUES ($1, $2::timestamptz, $3, $4::jsonb, $5::jsonb)"
      ].join("\n"),
      [
        report.reportId,
        report.timestamp,
        report.shouldAlert,
        JSON.stringify(report.alerts),
        JSON.stringify(report)
      ]
    );
  }

  public async listDriftReports(limit = 50): Promise<DriftReport[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM drift_reports",
      "ORDER BY timestamp DESC",
      "LIMIT $1"
    ].join("\n"), [limit]);
    return result.rows
      .map((row) => this.asDriftReport(row.payload))
      .filter((row): row is DriftReport => row !== null);
  }

  public async replaceProjectMemory(items: string[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM project_memory_entries");
      for (const text of items) {
        await client.query(
          [
            "INSERT INTO project_memory_entries(id, text_value, saved_at, payload)",
            "VALUES ($1, $2, $3::timestamptz, $4::jsonb)"
          ].join("\n"),
          [this.createId(), text, new Date().toISOString(), JSON.stringify({ text, savedAt: new Date().toISOString() })]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listProjectMemory(): Promise<string[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM project_memory_entries",
      "ORDER BY saved_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asRecord(row.payload))
      .map((payload) => (typeof payload.text === "string" ? payload.text : null))
      .filter((row): row is string => row !== null);
  }

  public async replaceFailureMemory(entries: FailureMemoryEntry[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM failure_memory_entries");
      for (const entry of entries) {
        await client.query(
          [
            "INSERT INTO failure_memory_entries(id, pattern, reason, preventive_action, tags_json, recorded_at, payload)",
            "VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::jsonb)"
          ].join("\n"),
          [
            this.createId(),
            entry.pattern,
            entry.reason,
            entry.preventiveAction,
            JSON.stringify(entry.tags),
            entry.recordedAt,
            JSON.stringify(entry)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listFailureMemory(): Promise<FailureMemoryEntry[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>([
      "SELECT payload",
      "FROM failure_memory_entries",
      "ORDER BY recorded_at ASC"
    ].join("\n"));
    return result.rows
      .map((row) => this.asFailureMemoryEntry(row.payload))
      .filter((row): row is FailureMemoryEntry => row !== null);
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
    await client.query([
      "CREATE TABLE IF NOT EXISTS cleanup_schedules(",
      "  id text PRIMARY KEY,",
      "  name text NOT NULL,",
      "  cron text NOT NULL,",
      "  action text NOT NULL,",
      "  status text NOT NULL,",
      "  days_unused integer NOT NULL,",
      "  limit_count integer NOT NULL,",
      "  require_approval boolean NOT NULL,",
      "  created_at timestamptz NOT NULL,",
      "  updated_at timestamptz NOT NULL,",
      "  last_run_at timestamptz",
      ")"
    ].join("\n"));
    await client.query([
      "CREATE TABLE IF NOT EXISTS metrics_samples(",
      "  id text PRIMARY KEY,",
      "  tool_name text NOT NULL,",
      "  trace_id text,",
      "  started_at timestamptz NOT NULL,",
      "  duration_ms integer NOT NULL,",
      "  status text NOT NULL,",
      "  cache_hit boolean NOT NULL DEFAULT false,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_metrics_samples_started_at ON metrics_samples(started_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS feedback_records(",
      "  feedback_id text PRIMARY KEY,",
      "  session_id text NOT NULL,",
      "  agent_name text,",
      "  rating text NOT NULL,",
      "  comment text,",
      "  timestamp timestamptz NOT NULL,",
      "  quality_score double precision,",
      "  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  user_id text,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_feedback_records_timestamp ON feedback_records(timestamp DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS reward_records(",
      "  reward_id text PRIMARY KEY,",
      "  source text NOT NULL,",
      "  session_id text,",
      "  agent_name text,",
      "  tool_name text,",
      "  reward double precision NOT NULL,",
      "  confidence double precision,",
      "  raw_metric jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "  reason text,",
      "  timestamp timestamptz NOT NULL,",
      "  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_reward_records_timestamp ON reward_records(timestamp DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS proposal_feedback_entries(",
      "  id text PRIMARY KEY,",
      "  resource_type text NOT NULL,",
      "  name text NOT NULL,",
      "  decision text NOT NULL,",
      "  topic text,",
      "  note text,",
      "  recorded_at timestamptz NOT NULL,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_proposal_feedback_entries_recorded_at ON proposal_feedback_entries(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS query_skill_feedback_entries(",
      "  id text PRIMARY KEY,",
      "  query text NOT NULL,",
      "  skill text NOT NULL,",
      "  decision text NOT NULL,",
      "  recorded_at timestamptz NOT NULL,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_query_skill_feedback_entries_recorded_at ON query_skill_feedback_entries(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS analytics_models(",
      "  name text PRIMARY KEY,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ")"
    ].join("\n"));
    await client.query([
      "CREATE TABLE IF NOT EXISTS agent_reputation_records(",
      "  id text PRIMARY KEY,",
      "  timestamp timestamptz NOT NULL,",
      "  agent_name text NOT NULL,",
      "  scope text NOT NULL,",
      "  scope_key text NOT NULL,",
      "  delta double precision NOT NULL,",
      "  score_before double precision NOT NULL,",
      "  score_after double precision NOT NULL,",
      "  reason text,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_agent_reputation_records_timestamp ON agent_reputation_records(timestamp DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS agent_synergy_records(",
      "  id text PRIMARY KEY,",
      "  recorded_at timestamptz NOT NULL,",
      "  agents_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  quality_score double precision,",
      "  session_id text,",
      "  persona text,",
      "  success boolean,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_agent_synergy_records_recorded_at ON agent_synergy_records(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS agent_graph_records(",
      "  id text PRIMARY KEY,",
      "  recorded_at timestamptz NOT NULL,",
      "  session_id text,",
      "  sequence_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  success boolean NOT NULL DEFAULT true,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_agent_graph_records_recorded_at ON agent_graph_records(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS output_ratio_feedback(",
      "  id text PRIMARY KEY,",
      "  recorded_at timestamptz NOT NULL,",
      "  model text NOT NULL,",
      "  agent text NOT NULL,",
      "  input_tokens integer NOT NULL,",
      "  output_tokens integer NOT NULL,",
      "  output_ratio double precision NOT NULL,",
      "  trace_id text,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_output_ratio_feedback_recorded_at ON output_ratio_feedback(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS drift_reports(",
      "  report_id text PRIMARY KEY,",
      "  timestamp timestamptz NOT NULL,",
      "  should_alert boolean NOT NULL DEFAULT false,",
      "  alerts_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_drift_reports_timestamp ON drift_reports(timestamp DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS project_memory_entries(",
      "  id text PRIMARY KEY,",
      "  text_value text NOT NULL,",
      "  saved_at timestamptz NOT NULL,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_project_memory_entries_saved_at ON project_memory_entries(saved_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS failure_memory_entries(",
      "  id text PRIMARY KEY,",
      "  pattern text NOT NULL,",
      "  reason text NOT NULL,",
      "  preventive_action text NOT NULL,",
      "  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  recorded_at timestamptz NOT NULL,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_failure_memory_entries_recorded_at ON failure_memory_entries(recorded_at DESC)");
    await client.query([
      "CREATE TABLE IF NOT EXISTS skill_rating_entries(",
      "  id text PRIMARY KEY,",
      "  skill text NOT NULL,",
      "  rating integer NOT NULL,",
      "  topic text,",
      "  note text,",
      "  recorded_at timestamptz NOT NULL,",
      "  payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ")"
    ].join("\n"));
    await client.query("CREATE INDEX IF NOT EXISTS idx_skill_rating_entries_recorded_at ON skill_rating_entries(recorded_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_skill_rating_entries_skill ON skill_rating_entries(skill)");
  }

  private createId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private asUserFeedback(value: unknown): UserFeedback | null {
    const payload = this.asRecord(value);
    if (typeof payload.feedbackId !== "string" || typeof payload.sessionId !== "string" || typeof payload.rating !== "string" || typeof payload.timestamp !== "string") {
      return null;
    }
    return payload as unknown as UserFeedback;
  }

  private asRewardRecord(value: unknown): RewardRecord | null {
    const payload = this.asRecord(value);
    if (typeof payload.rewardId !== "string" || typeof payload.source !== "string" || typeof payload.reward !== "number" || typeof payload.timestamp !== "string") {
      return null;
    }
    return payload as unknown as RewardRecord;
  }

  private async loadNamedModel(name: string): Promise<Record<string, unknown> | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ payload: unknown }>(
      "SELECT payload FROM analytics_models WHERE name = $1",
      [name]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.asRecord(row.payload);
  }

  private asProposalFeedbackEntry(value: unknown): ProposalFeedbackEntry | null {
    const payload = this.asRecord(value);
    if (
      (payload.resourceType !== "skills" && payload.resourceType !== "tools" && payload.resourceType !== "presets") ||
      typeof payload.name !== "string" ||
      typeof payload.decision !== "string" ||
      typeof payload.recordedAt !== "string"
    ) {
      return null;
    }
    return payload as unknown as ProposalFeedbackEntry;
  }

  private asQuerySkillFeedbackEntry(value: unknown): QuerySkillFeedbackEntry | null {
    const payload = this.asRecord(value);
    if (
      typeof payload.query !== "string" ||
      typeof payload.skill !== "string" ||
      (payload.decision !== "accepted" && payload.decision !== "rejected") ||
      typeof payload.recordedAt !== "string"
    ) {
      return null;
    }
    return payload as unknown as QuerySkillFeedbackEntry;
  }

  private asAgentReputationRecord(value: unknown): AgentReputationRecord | null {
    const payload = this.asRecord(value);
    if (
      typeof payload.id !== "string" ||
      typeof payload.timestamp !== "string" ||
      typeof payload.agentName !== "string" ||
      typeof payload.scope !== "string" ||
      typeof payload.scopeKey !== "string" ||
      typeof payload.delta !== "number" ||
      typeof payload.scoreBefore !== "number" ||
      typeof payload.scoreAfter !== "number"
    ) {
      return null;
    }
    return payload as unknown as AgentReputationRecord;
  }

  private asAgentSynergyRecord(value: unknown): AgentSynergyRecord | null {
    const payload = this.asRecord(value);
    if (typeof payload.recordedAt !== "string" || !Array.isArray(payload.agents)) {
      return null;
    }
    return payload as unknown as AgentSynergyRecord;
  }

  private asAgentGraphRecord(value: unknown): AgentGraphRecord | null {
    const payload = this.asRecord(value);
    if (typeof payload.recordedAt !== "string" || !Array.isArray(payload.sequence) || typeof payload.success !== "boolean") {
      return null;
    }
    return payload as unknown as AgentGraphRecord;
  }

  private asOutputRatioFeedbackEntry(value: unknown): OutputRatioFeedbackEntry | null {
    const payload = this.asRecord(value);
    if (
      typeof payload.recordedAt !== "string" ||
      typeof payload.model !== "string" ||
      typeof payload.agent !== "string" ||
      typeof payload.inputTokens !== "number" ||
      typeof payload.outputTokens !== "number" ||
      typeof payload.outputRatio !== "number"
    ) {
      return null;
    }
    return payload as unknown as OutputRatioFeedbackEntry;
  }

  private asDriftReport(value: unknown): DriftReport | null {
    const payload = this.asRecord(value);
    if (
      typeof payload.reportId !== "string" ||
      typeof payload.timestamp !== "string" ||
      typeof payload.shouldAlert !== "boolean" ||
      !Array.isArray(payload.alerts)
    ) {
      return null;
    }
    return payload as unknown as DriftReport;
  }

  private asFailureMemoryEntry(value: unknown): FailureMemoryEntry | null {
    const payload = this.asRecord(value);
    if (
      typeof payload.pattern !== "string" ||
      typeof payload.reason !== "string" ||
      typeof payload.preventiveAction !== "string" ||
      !Array.isArray(payload.tags) ||
      typeof payload.recordedAt !== "string"
    ) {
      return null;
    }
    return {
      pattern: payload.pattern,
      reason: payload.reason,
      preventiveAction: payload.preventiveAction,
      tags: payload.tags.filter((tag): tag is string => typeof tag === "string"),
      recordedAt: payload.recordedAt
    };
  }
}
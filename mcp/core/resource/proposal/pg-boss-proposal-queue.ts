import { PgBoss } from "pg-boss";
import { Pool, type PoolClient } from "pg";
import {
  buildProposal,
  computeProposalPriority,
  nextProposalId,
  type ApprovalStage,
  type ListProposalsOptions,
  type NewProposalInput,
  type ProposalApprovalAction,
  type ProposalApprovalState,
  type ProposalQueueSummary,
  type ProposalRecord,
  type ProposalResourceType,
  type ProposalStatus
} from "./queue.js";
import type { ProposalQueueStore } from "./proposal-queue-store.js";

interface ProposalRow {
  id: string;
  resource_type: ProposalResourceType;
  name: string;
  content: string;
  confidence: number | string;
  source_event: string | null;
  origin: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  reject_reason: string | null;
  approval_json: ProposalApprovalState | string | null;
  status: ProposalStatus;
  boss_job_id: string | null;
}

export interface PgBossProposalQueueStoreOptions {
  databaseUrl: string;
  queueName?: string;
}

function normalizeApprovalStages(stages?: ApprovalStage[]): ApprovalStage[] {
  const defaults: ApprovalStage[] = ["reviewer", "admin"];
  if (!Array.isArray(stages) || stages.length === 0) {
    return defaults;
  }
  const normalized = [...new Set(stages)];
  const filtered = normalized.filter((stage): stage is ApprovalStage => stage === "reviewer" || stage === "admin");
  return filtered.length > 0 ? filtered : defaults;
}

function ensureApprovalState(record: ProposalRecord): ProposalApprovalState {
  if (record.approval) {
    return record.approval;
  }
  const requiredStages = normalizeApprovalStages();
  return {
    requiredStages,
    currentStage: requiredStages[0],
    completedStages: [],
    history: []
  };
}

function asIsoString(value: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: ProposalRow): ProposalRecord {
  const approval = typeof row.approval_json === "string"
    ? JSON.parse(row.approval_json) as ProposalApprovalState
    : row.approval_json ?? undefined;
  return {
    id: row.id,
    resourceType: row.resource_type,
    name: row.name,
    content: row.content,
    confidence: Number(row.confidence),
    sourceEvent: row.source_event ?? undefined,
    origin: row.origin ?? undefined,
    createdAt: asIsoString(row.created_at) ?? new Date(0).toISOString(),
    resolvedAt: asIsoString(row.resolved_at),
    rejectReason: row.reject_reason ?? undefined,
    approval,
    status: row.status
  };
}

export class PgBossProposalQueueStore implements ProposalQueueStore {
  private readonly pool: Pool;
  private readonly boss: PgBoss;
  private readonly queueName: string;
  private schemaReady = false;

  private constructor(pool: Pool, boss: PgBoss, queueName: string) {
    this.pool = pool;
    this.boss = boss;
    this.queueName = queueName;
  }

  public static async open(options: PgBossProposalQueueStoreOptions): Promise<PgBossProposalQueueStore> {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PgBossProposalQueueStore");
    }

    const pool = new Pool({ connectionString: options.databaseUrl });
    const boss = new PgBoss(options.databaseUrl);
    await boss.start();
    const store = new PgBossProposalQueueStore(pool, boss, options.queueName ?? "resource-proposals");
    await store.ensureSchema();
    try {
      await store.boss.createQueue(store.queueName);
    } catch {
      // Queue may already exist.
    }
    return store;
  }

  public async close(): Promise<void> {
    await this.boss.stop();
    await this.pool.end();
  }

  public async scheduleRecurringJob(input: {
    queue: string;
    cron: string;
    data?: Record<string, unknown>;
    key?: string;
  }): Promise<void> {
    await this.ensureSchema();
    try {
      await this.boss.createQueue(input.queue);
    } catch {
      // queue may already exist
    }
    await this.boss.schedule(input.queue, input.cron, input.data ?? null, {
      key: input.key
    });
  }

  public async unscheduleRecurringJob(input: { queue: string; key?: string }): Promise<void> {
    await this.ensureSchema();
    await this.boss.unschedule(input.queue, input.key);
  }

  public async enqueue(input: NewProposalInput, now: Date = new Date()): Promise<ProposalRecord> {
    await this.ensureSchema();
    const id = nextProposalId(now.getTime());
    const record = buildProposal(input, now, id);
    await this.pool.query(
      [
        "INSERT INTO resource_proposals(",
        "  id, resource_type, name, content, confidence, source_event, origin, created_at, approval_json, status",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb, $10)"
      ].join("\n"),
      [
        record.id,
        record.resourceType,
        record.name,
        record.content,
        record.confidence,
        record.sourceEvent ?? null,
        record.origin ?? null,
        record.createdAt,
        JSON.stringify(record.approval ?? null),
        record.status
      ]
    );

    const bossJobId = await this.boss.send(this.queueName, {
      proposalId: record.id,
      resourceType: record.resourceType,
      name: record.name,
      sourceEvent: record.sourceEvent,
      origin: record.origin
    });

    if (bossJobId) {
      await this.pool.query(
        "UPDATE resource_proposals SET boss_job_id = $2 WHERE id = $1",
        [record.id, bossJobId]
      );
    }

    return record;
  }

  public async list(options: ListProposalsOptions = {}): Promise<ProposalRecord[]> {
    await this.ensureSchema();
    const values: Array<string | number> = [];
    const clauses: string[] = [];

    if (options.status) {
      values.push(options.status);
      clauses.push(`status = $${values.length}`);
    }
    if (options.resourceType) {
      values.push(options.resourceType);
      clauses.push(`resource_type = $${values.length}`);
    }

    const result = await this.pool.query<ProposalRow>(
      [
        "SELECT id, resource_type, name, content, confidence, source_event, origin, created_at, resolved_at, reject_reason, approval_json, status, boss_job_id",
        "FROM resource_proposals",
        clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        "ORDER BY created_at DESC"
      ].filter((line) => line.length > 0).join("\n"),
      values
    );

    const now = options.now ?? new Date();
    const rates = options.historyAcceptRateByResource ?? {};
    let records = result.rows.map((row) => mapRow(row)).map((record) => {
      const rate = rates[`${record.resourceType}:${record.name}`];
      const priority = computeProposalPriority(record, { now, historyAcceptRate: rate });
      return {
        ...record,
        priorityScore: Number(priority.score.toFixed(6)),
        priorityBreakdown: {
          topicRelevance: Number(priority.topicRelevance.toFixed(6)),
          historyAcceptRate: Number(priority.historyAcceptRate.toFixed(6)),
          stalenessPenalty: Number(priority.stalenessPenalty.toFixed(6))
        }
      };
    });

    records.sort((a, b) => {
      const aPriority = a.priorityScore ?? Number.NEGATIVE_INFINITY;
      const bPriority = b.priorityScore ?? Number.NEGATIVE_INFINITY;
      if (bPriority !== aPriority) {
        return bPriority - aPriority;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    if (typeof options.limit === "number" && options.limit > 0) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  public async get(id: string): Promise<ProposalRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<ProposalRow>(
      [
        "SELECT id, resource_type, name, content, confidence, source_event, origin, created_at, resolved_at, reject_reason, approval_json, status, boss_job_id",
        "FROM resource_proposals WHERE id = $1"
      ].join("\n"),
      [id]
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  public async approve(id: string): Promise<ProposalRecord> {
    const current = await this.requirePending(id);
    const approval = ensureApprovalState(current.record);
    const now = new Date().toISOString();
    const history: ProposalApprovalAction[] = [
      ...approval.history,
      {
        stage: approval.currentStage,
        actor: "system",
        decision: "approved",
        decidedAt: now,
        comment: "legacy direct approval"
      }
    ];

    return this.moveProposal(current, "approved", {
      approval: {
        ...approval,
        completedStages: [...new Set([...approval.completedStages, ...approval.requiredStages])],
        currentStage: approval.requiredStages[approval.requiredStages.length - 1] ?? "admin",
        history,
        finalApprovedAt: now
      }
    });
  }

  public async reject(id: string, reason: string): Promise<ProposalRecord> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      throw new Error("rejectReason must not be empty");
    }
    const current = await this.requirePending(id);
    const approval = ensureApprovalState(current.record);
    const now = new Date().toISOString();
    const history: ProposalApprovalAction[] = [
      ...approval.history,
      {
        stage: approval.currentStage,
        actor: "system",
        decision: "rejected",
        decidedAt: now,
        comment: trimmed
      }
    ];

    return this.moveProposal(current, "rejected", {
      rejectReason: trimmed,
      approval: {
        ...approval,
        history,
        rejectedAt: now
      }
    });
  }

  public async approveStage(
    id: string,
    input: { stage: ApprovalStage; actor: string; comment?: string }
  ): Promise<ProposalRecord> {
    const current = await this.requirePending(id);
    const approval = ensureApprovalState(current.record);
    if (approval.currentStage !== input.stage) {
      throw new Error(`current stage is ${approval.currentStage}; requested ${input.stage}`);
    }

    const now = new Date().toISOString();
    const completedStages = [...new Set([...approval.completedStages, input.stage])];
    const history: ProposalApprovalAction[] = [
      ...approval.history,
      {
        stage: input.stage,
        actor: input.actor,
        decision: "approved",
        decidedAt: now,
        comment: input.comment
      }
    ];

    const requiredStages = normalizeApprovalStages(approval.requiredStages);
    const currentIdx = requiredStages.indexOf(input.stage);
    const nextStage = requiredStages[currentIdx + 1];

    if (!nextStage) {
      return this.moveProposal(current, "approved", {
        approval: {
          ...approval,
          requiredStages,
          completedStages,
          history,
          finalApprovedAt: now
        }
      });
    }

    return this.updatePending(current, {
      approval: {
        ...approval,
        requiredStages,
        completedStages,
        currentStage: nextStage,
        history
      }
    });
  }

  public async rejectStage(
    id: string,
    input: { stage: ApprovalStage; actor: string; reason: string }
  ): Promise<ProposalRecord> {
    const current = await this.requirePending(id);
    const approval = ensureApprovalState(current.record);
    if (approval.currentStage !== input.stage) {
      throw new Error(`current stage is ${approval.currentStage}; requested ${input.stage}`);
    }

    const trimmed = input.reason.trim();
    if (trimmed.length === 0) {
      throw new Error("rejectReason must not be empty");
    }
    const now = new Date().toISOString();
    const history: ProposalApprovalAction[] = [
      ...approval.history,
      {
        stage: input.stage,
        actor: input.actor,
        decision: "rejected",
        decidedAt: now,
        comment: trimmed
      }
    ];

    return this.moveProposal(current, "rejected", {
      rejectReason: trimmed,
      approval: {
        ...approval,
        history,
        rejectedAt: now
      }
    });
  }

  public async summarize(): Promise<ProposalQueueSummary> {
    const rows = await this.list();
    const summary: ProposalQueueSummary = {
      pending: 0,
      approved: 0,
      rejected: 0,
      byResourceType: {
        skills: { pending: 0, approved: 0, rejected: 0 },
        tools: { pending: 0, approved: 0, rejected: 0 },
        presets: { pending: 0, approved: 0, rejected: 0 }
      }
    };

    for (const row of rows) {
      summary[row.status] += 1;
      summary.byResourceType[row.resourceType][row.status] += 1;
    }
    return summary;
  }

  private async requirePending(id: string): Promise<{ record: ProposalRecord; bossJobId: string | null }> {
    await this.ensureSchema();
    const result = await this.pool.query<ProposalRow>(
      [
        "SELECT id, resource_type, name, content, confidence, source_event, origin, created_at, resolved_at, reject_reason, approval_json, status, boss_job_id",
        "FROM resource_proposals WHERE id = $1"
      ].join("\n"),
      [id]
    );
    const row = result.rows[0];
    if (!row || row.status !== "pending") {
      throw new Error(`proposal not found in pending: ${id}`);
    }
    return { record: mapRow(row), bossJobId: row.boss_job_id };
  }

  private async updatePending(
    current: { record: ProposalRecord; bossJobId: string | null },
    patch: Partial<ProposalRecord>
  ): Promise<ProposalRecord> {
    await this.pool.query(
      "UPDATE resource_proposals SET approval_json = $2::jsonb WHERE id = $1 AND status = 'pending'",
      [current.record.id, JSON.stringify(patch.approval ?? null)]
    );
    return {
      ...current.record,
      ...patch,
      approval: patch.approval ?? current.record.approval
    };
  }

  private async moveProposal(
    current: { record: ProposalRecord; bossJobId: string | null },
    status: "approved" | "rejected",
    patch: Partial<ProposalRecord>
  ): Promise<ProposalRecord> {
    const resolvedAt = new Date().toISOString();
    await this.pool.query(
      [
        "UPDATE resource_proposals",
        "SET status = $2, resolved_at = $3::timestamptz, reject_reason = $4, approval_json = $5::jsonb, boss_job_id = NULL",
        "WHERE id = $1"
      ].join("\n"),
      [
        current.record.id,
        status,
        resolvedAt,
        patch.rejectReason ?? null,
        JSON.stringify(patch.approval ?? null)
      ]
    );
    if (current.bossJobId) {
      try {
        await this.boss.deleteJob(this.queueName, current.bossJobId);
      } catch {
        // ignore queue cleanup failures
      }
    }

    return {
      ...current.record,
      ...patch,
      status,
      resolvedAt
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
        "CREATE TABLE IF NOT EXISTS resource_proposals(",
        "  id text PRIMARY KEY,",
        "  resource_type text NOT NULL,",
        "  name text NOT NULL,",
        "  content text NOT NULL,",
        "  confidence double precision NOT NULL DEFAULT 0,",
        "  source_event text,",
        "  origin text,",
        "  created_at timestamptz NOT NULL DEFAULT NOW(),",
        "  resolved_at timestamptz,",
        "  reject_reason text,",
        "  approval_json jsonb,",
        "  status text NOT NULL,",
        "  boss_job_id text",
        ")"
      ].join("\n")
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_resource_proposals_status ON resource_proposals(status)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_resource_proposals_created_at ON resource_proposals(created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_resource_proposals_resource_type ON resource_proposals(resource_type)");
  }
}
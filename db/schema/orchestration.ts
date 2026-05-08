import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "paused",
  "completed",
  "failed"
]);

export const orchestrationStepStatusEnum = pgEnum("orchestration_step_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const orchestrationSessionsTable = pgTable(
  "orchestration_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    sessionJson: jsonb("session_json").$type<Record<string, unknown>>().notNull(),
    historyCount: integer("history_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optimistic-lock version counter. Increment on every write. */
    version: integer("version").notNull().default(0),
    /** Lifecycle status of this session. */
    status: sessionStatusEnum("status").notNull().default("active"),
    /** Timestamp when advisory lock was last acquired (cleared on release). */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** Identity of the process that holds the advisory lock. */
    lockOwner: text("lock_owner")
  },
  (table) => ({
    updatedAtIdx: index("idx_orchestration_sessions_updated_at").on(table.updatedAt),
    statusIdx: index("idx_orchestration_sessions_status").on(table.status),
    tenantUpdatedAtIdx: index("idx_orchestration_sessions_tenant_updated_at").on(table.tenantId, table.updatedAt)
  })
);

export const orchestrationStepsTable = pgTable(
  "orchestration_steps",
  {
    tenantId: text("tenant_id"),
    sessionId: text("session_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    agent: text("agent").notNull(),
    status: orchestrationStepStatusEnum("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    inputHash: text("input_hash"),
    outputHash: text("output_hash"),
    errorJson: jsonb("error_json").$type<Record<string, unknown> | null>(),
    checkpointJson: jsonb("checkpoint_json").$type<Record<string, unknown> | null>()
  },
  (table) => ({
    sessionStepIdx: index("idx_orchestration_steps_session_step").on(table.sessionId, table.stepIndex),
    sessionStatusIdx: index("idx_orchestration_steps_session_status").on(table.sessionId, table.status),
    agentStatusIdx: index("idx_orchestration_steps_agent_status").on(table.agent, table.status),
    tenantSessionStatusIdx: index("idx_orchestration_steps_tenant_session_status").on(table.tenantId, table.sessionId, table.status)
  })
);
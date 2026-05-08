import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const toolExecutionsTable = pgTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    sessionId: text("session_id"),
    toolName: text("tool_name").notNull(),
    argsHash: text("args_hash").notNull(),
    argsJson: jsonb("args_json").$type<Record<string, unknown>>().notNull().default({}),
    outputHash: text("output_hash"),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>().notNull().default({}),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    toolArgsIdx: index("idx_tool_executions_tool_args").on(table.toolName, table.argsHash),
    tenantToolArgsIdx: index("idx_tool_executions_tenant_tool_args").on(table.tenantId, table.toolName, table.argsHash),
    sessionTsIdx: index("idx_tool_executions_session_ts").on(table.sessionId, table.ts),
    recordedAtIdx: index("idx_tool_executions_recorded_at").on(table.recordedAt)
  })
);
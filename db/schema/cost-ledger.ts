import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const costLedgerTable = pgTable(
  "cost_ledger",
  {
    id: text("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").notNull(),
    tenantId: text("tenant_id"),
    sessionId: text("session_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    usdEstimateMicro: integer("usd_estimate_micro").notNull().default(0),
    toolName: text("tool_name").notNull(),
    traceId: text("trace_id"),
    status: text("status").notNull().default("success")
  },
  (t) => ({
    actorTsIdx: index("idx_cost_ledger_actor_ts").on(t.actorId, t.ts),
    tenantTsIdx: index("idx_cost_ledger_tenant_ts").on(t.tenantId, t.ts),
    sessionTsIdx: index("idx_cost_ledger_session_ts").on(t.sessionId, t.ts),
    modelTsIdx: index("idx_cost_ledger_model_ts").on(t.model, t.ts)
  })
);

import { pgTable, bigserial, timestamp, text, real, integer, boolean, index } from "drizzle-orm/pg-core";

/**
 * T-34: SLO Burn Rate tracking
 *
 * Stores SLO metrics (success rate, latency p95, cost per chat) and burn rate calculations
 * for error budget management and feature freeze triggering.
 */

export const sloBurn = pgTable(
  "slo_burn",
  {
    id: bigserial("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    sloId: text("slo_id").notNull(), // 'success_rate' | 'latency_p95' | 'cost_per_chat'
    sloTarget: real("slo_target").notNull(), // 0.995, 1000, 0.5
    currentValue: real("current_value").notNull(),
    errorRate: real("error_rate").notNull(), // (currentValue - target) / target or similar
    burnRate: real("burn_rate").notNull(), // error_rate / allowed_error_rate
    budgetRemainingSec: integer("budget_remaining_sec").notNull(), // seconds remaining in rolling window
    window: text("window").notNull(), // '5m' | '1h' | '1d' | '30d'
    alertFired: boolean("alert_fired").defaultValue(false)
  },
  (table) => ({
    idxTs: index("idx_slo_burn_ts").on(table.ts),
    idxSloId: index("idx_slo_burn_slo_id").on(table.sloId),
    idxWindow: index("idx_slo_burn_window").on(table.window)
  })
);

export type SloBurn = typeof sloBurn.$inferSelect;
export type SloBurnInsert = typeof sloBurn.$inferInsert;

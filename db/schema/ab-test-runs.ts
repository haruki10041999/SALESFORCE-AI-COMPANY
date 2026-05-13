import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  varchar,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { sessionHistoryTable } from "./session-history";

/**
 * AB test run results from replay evaluation
 * Stores variant comparisons and scoring outcomes for closed-loop learning
 */
export const abTestRunsTable = pgTable("ab_test_runs", {
  id: serial("id").primaryKey(),
  tenant_id: varchar("tenant_id", { length: 128 }).notNull(),
  session_id: varchar("session_id", { length: 255 }).notNull(),
  variant_id: varchar("variant_id", { length: 128 }).notNull(), // e.g., "prompt-v2", "order-shuffle"
  variant_type: varchar("variant_type", { length: 50 }).notNull(), // "prompt_template" | "trigger_rule" | "skill_swap" | "agent_order"
  variant_config: jsonb("variant_config").notNull(), // Full override config applied
  control_score: numeric("control_score", { precision: 5, scale: 3 }).notNull(), // 0.000 to 100.000
  variant_score: numeric("variant_score", { precision: 5, scale: 3 }).notNull(),
  winner: varchar("winner", { length: 20 }).notNull(), // "control" | "variant" | "tie"
  score_diff: numeric("score_diff", { precision: 5, scale: 3 }), // variant_score - control_score
  is_statistically_significant: boolean("is_statistically_significant").default(false),
  confidence_level: numeric("confidence_level", { precision: 3, scale: 2 }), // 0.00 to 0.99
  scorer_version: varchar("scorer_version", { length: 20 }).notNull(),
  proposed_at: timestamp("proposed_at").defaultNow().notNull(),
  proposed_to_governance: boolean("proposed_to_governance").default(false),
  governance_proposal_id: varchar("governance_proposal_id", { length: 255 }),
  snapshot_schema_version: integer("snapshot_schema_version").default(2).notNull(),
  applied_at: timestamp("applied_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const abTestRunsRelations = relations(
  abTestRunsTable,
  ({ one }) => ({
    session: one(sessionHistoryTable, {
      fields: [abTestRunsTable.session_id],
      references: [sessionHistoryTable.id],
    }),
  }),
);

export type ABTestRun = typeof abTestRunsTable.$inferSelect;
export type InsertABTestRun = typeof abTestRunsTable.$inferInsert;

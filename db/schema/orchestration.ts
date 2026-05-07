import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const orchestrationSessionsTable = pgTable(
  "orchestration_sessions",
  {
    id: text("id").primaryKey(),
    sessionJson: jsonb("session_json").$type<Record<string, unknown>>().notNull(),
    historyCount: integer("history_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    updatedAtIdx: index("idx_orchestration_sessions_updated_at").on(table.updatedAt)
  })
);
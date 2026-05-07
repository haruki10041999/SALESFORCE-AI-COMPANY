import { index, jsonb, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

export const governanceStateTable = pgTable(
  "governance_state",
  {
    id: smallint("id").primaryKey().default(1),
    stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    updatedAtIdx: index("idx_governance_state_updated_at").on(table.updatedAt)
  })
);

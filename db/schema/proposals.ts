import { doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const resourceProposalsTable = pgTable(
  "resource_proposals",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0),
    sourceEvent: text("source_event"),
    origin: text("origin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    approvalJson: jsonb("approval_json").$type<Record<string, unknown> | null>(),
    status: text("status").notNull(),
    bossJobId: text("boss_job_id")
  },
  (table) => ({
    statusIdx: index("idx_resource_proposals_status").on(table.status),
    createdAtIdx: index("idx_resource_proposals_created_at").on(table.createdAt),
    resourceTypeIdx: index("idx_resource_proposals_resource_type").on(table.resourceType)
  })
);
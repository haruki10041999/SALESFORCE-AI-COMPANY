import { index, jsonb, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

export const memoryRecordsTable = pgTable(
  "memory_records",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    updatedAtIdx: index("idx_memory_records_updated_at").on(table.updatedAt)
  })
);

import { pgTable, serial, text, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Session history table for storing recorded session snapshots
 */
export const sessionHistoryTable = pgTable("session_history", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenant_id: varchar("tenant_id", { length: 128 }).notNull(),
  session_type: varchar("session_type", { length: 50 }).notNull(), // agent-session | flow-session
  system_prompt: text("system_prompt"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  model_used: varchar("model_used", { length: 100 }),
  status: varchar("status", { length: 50 }).default("in-progress"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type SessionHistory = typeof sessionHistoryTable.$inferSelect;
export type InsertSessionHistory = typeof sessionHistoryTable.$inferInsert;

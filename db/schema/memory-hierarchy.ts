import { pgTable, text, bigserial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Hierarchical memory schema
 * Documents → Sections → Chunks (3-level hierarchy)
 */

export const memoryDocumentsTable = pgTable("memory_documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  externalId: text("external_id").notNull().unique(),
  tenant_id: text("tenant_id").notNull().default("default"),
  title: text("title").notNull(),
  source: text("source"), // e.g., "file", "wiki", "code"
  estimatedTokens: integer("estimated_tokens").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const memorySectionsTable = pgTable("memory_sections", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  documentId: bigserial("document_id", { mode: "number" })
    .notNull()
    .references(() => memoryDocumentsTable.id, { onDelete: "cascade" }),
  sectionIndex: integer("section_index").notNull(),
  heading: text("heading"),
  level: integer("level").notNull(), // 0-6 for markdown levels
  content: text("content").notNull(),
  summary: text("summary"),
  estimatedTokens: integer("estimated_tokens").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const memoryChunksTable = pgTable("memory_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sectionId: bigserial("section_id", { mode: "number" })
    .notNull()
    .references(() => memorySectionsTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  startToken: integer("start_token").notNull(),
  endToken: integer("end_token").notNull(),
  // Vector (768-dim pgvector column managed separately by T-06 schema)
  embeddingModel: text("embedding_model"),
  embeddingDim: integer("embedding_dim"),
  vectorTier: text("vector_tier").notNull().default("warm"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Relations
export const memoryDocumentsRelations = relations(memoryDocumentsTable, ({ many }) => ({
  sections: many(memorySectionsTable),
}));

export const memorySectionsRelations = relations(memorySectionsTable, ({ one, many }) => ({
  document: one(memoryDocumentsTable, {
    fields: [memorySectionsTable.documentId],
    references: [memoryDocumentsTable.id],
  }),
  chunks: many(memoryChunksTable),
}));

export const memoryChunksRelations = relations(memoryChunksTable, ({ one }) => ({
  section: one(memorySectionsTable, {
    fields: [memoryChunksTable.sectionId],
    references: [memorySectionsTable.id],
  }),
}));

// Types
export type MemoryDocument = typeof memoryDocumentsTable.$inferSelect;
export type MemoryDocumentInsert = typeof memoryDocumentsTable.$inferInsert;
export type MemorySection = typeof memorySectionsTable.$inferSelect;
export type MemorySectionInsert = typeof memorySectionsTable.$inferInsert;
export type MemoryChunk = typeof memoryChunksTable.$inferSelect;
export type MemoryChunkInsert = typeof memoryChunksTable.$inferInsert;

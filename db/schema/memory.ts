import { boolean, index, integer, jsonb, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

export const memoryRecordsTable = pgTable(
  "memory_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    text: text("text").notNull(),
    tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Which embedding model produced this vector. Defaults to 'legacy-768' for existing rows. */
    embeddingModel: text("embedding_model").notNull().default("legacy-768"),
    /** Dimension of the stored vector. */
    embeddingDim: integer("embedding_dim").notNull().default(768),
    /** Whether the vector was L2-normalised before storage. */
    embeddingNorm: boolean("embedding_norm").notNull().default(true),
    /** Hot / warm / cold storage tier. */
    vectorTier: text("vector_tier").notNull().default("warm")
  },
  (table) => ({
    updatedAtIdx: index("idx_memory_records_updated_at").on(table.updatedAt),
    modelDimIdx: index("idx_memory_records_model_dim").on(table.embeddingModel, table.embeddingDim),
    tenantModelDimIdx: index("idx_memory_records_tenant_model_dim").on(table.tenantId, table.embeddingModel, table.embeddingDim),
    vectorTierIdx: index("idx_memory_records_vector_tier").on(table.vectorTier)
  })
);

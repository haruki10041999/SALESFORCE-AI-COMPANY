import { relations } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const knowledgeEntitiesTable = pgTable(
  "knowledge_entities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    entityType: text("entity_type").notNull(),
    entityName: text("entity_name").notNull(),
    stableKey: text("stable_key").notNull().unique(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
  },
  (table) => ({
    tenantTypeNameIdx: index("idx_knowledge_entities_tenant_type_name").on(
      table.tenantId,
      table.entityType,
      table.entityName
    ),
    tenantUpdatedAtIdx: index("idx_knowledge_entities_tenant_updated_at").on(table.tenantId, table.updatedAt)
  })
);

export const knowledgeRelationsTable = pgTable(
  "knowledge_relations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    srcEntityId: bigserial("src_entity_id", { mode: "number" })
      .notNull()
      .references(() => knowledgeEntitiesTable.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    dstEntityId: bigserial("dst_entity_id", { mode: "number" })
      .notNull()
      .references(() => knowledgeEntitiesTable.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
  },
  (table) => ({
    srcTypeIdx: index("idx_knowledge_relations_src_type").on(table.srcEntityId, table.relationType),
    dstIdx: index("idx_knowledge_relations_dst").on(table.dstEntityId),
    tenantUpdatedAtIdx: index("idx_knowledge_relations_tenant_updated_at").on(table.tenantId, table.updatedAt)
  })
);

export const knowledgeEntitiesRelations = relations(knowledgeEntitiesTable, ({ many }) => ({
  outgoing: many(knowledgeRelationsTable, { relationName: "knowledge_relation_src" }),
  incoming: many(knowledgeRelationsTable, { relationName: "knowledge_relation_dst" })
}));

export const knowledgeRelationsRelations = relations(knowledgeRelationsTable, ({ one }) => ({
  src: one(knowledgeEntitiesTable, {
    relationName: "knowledge_relation_src",
    fields: [knowledgeRelationsTable.srcEntityId],
    references: [knowledgeEntitiesTable.id]
  }),
  dst: one(knowledgeEntitiesTable, {
    relationName: "knowledge_relation_dst",
    fields: [knowledgeRelationsTable.dstEntityId],
    references: [knowledgeEntitiesTable.id]
  })
}));

export type KnowledgeEntity = typeof knowledgeEntitiesTable.$inferSelect;
export type KnowledgeEntityInsert = typeof knowledgeEntitiesTable.$inferInsert;
export type KnowledgeRelation = typeof knowledgeRelationsTable.$inferSelect;
export type KnowledgeRelationInsert = typeof knowledgeRelationsTable.$inferInsert;

import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const actorTypeEnum = pgEnum("actor_type", [
  "user",
  "service_account",
  "agent",
  "system"
]);

export const actorsTable = pgTable(
  "actors",
  {
    id: text("id").primaryKey(),
    actorType: actorTypeEnum("actor_type").notNull(),
    displayName: text("display_name"),
    role: text("role"),
    tenantId: text("tenant_id"),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    typeIdx: index("idx_actors_actor_type").on(t.actorType),
    roleIdx: index("idx_actors_role").on(t.role),
    tenantIdx: index("idx_actors_tenant_id").on(t.tenantId)
  })
);

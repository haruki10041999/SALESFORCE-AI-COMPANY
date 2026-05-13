import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  integer,
  unique
} from "drizzle-orm/pg-core";

export const eventStoreTable = pgTable(
  "event_store",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    globalSeq: bigserial("global_seq", { mode: "number" }).unique().notNull(),
    streamId: text("stream_id").notNull(),
    eventType: text("event_type").notNull(),
    version: integer("version").notNull(),
    tenantId: text("tenant_id"),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("active")
  },
  (t) => ({
    streamVersionUnique: unique("event_store_stream_version").on(t.streamId, t.version),
    streamIdx: index("idx_event_store_stream").on(t.streamId, t.version),
    typeIdx: index("idx_event_store_type").on(t.eventType),
    tenantIdx: index("idx_event_store_tenant").on(t.tenantId, t.globalSeq),
    seqIdx: index("idx_event_store_seq").on(t.globalSeq)
  })
);

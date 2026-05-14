import { Pool, type PoolClient } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "./pg-pool-registry.js";
import { currentTenantId } from "../identity/tenant-context.js";
import {
  type AppendEventInput,
  type DomainEvent,
  type EventHandler,
  type EventStore,
  type OutboxCapableEventStore,
  type ReadEventsOptions,
  type StoredEvent,
  type SubscribeOptions,
  OptimisticConcurrencyError
} from "../ports/event-store.js";
import type { OutboxEnqueueInput, OutboxPort } from "../ports/outbox-port.js";
import { createPostgresUnitOfWork } from "./unit-of-work.js";
import { EventSchemaRegistry } from "../event/schema-registry.js";
import { DOMAIN_EVENT_SCHEMA_REGISTRY } from "../../domain/events/index.js";

export interface PostgresEventStoreOptions {
  databaseUrl: string;
}

export class PostgresEventStore implements EventStore, OutboxCapableEventStore {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private schemaReady = false;
  private readonly subscribers: Array<{ handler: EventHandler; options: SubscribeOptions }> = [];
  private readonly schemaRegistry = new EventSchemaRegistry(DOMAIN_EVENT_SCHEMA_REGISTRY);

  private constructor(pool: Pool, poolKey: string) {
    this.pool = pool;
    this.poolKey = poolKey;
  }

  static async open(options: PostgresEventStoreOptions): Promise<PostgresEventStore> {
    if (!options.databaseUrl?.trim()) {
      throw new Error("DATABASE_URL is required for PostgresEventStore");
    }
    const key = `event-store:${options.databaseUrl.trim()}`;
    const pool = getOrCreatePgPool(key, options.databaseUrl.trim());
    const store = new PostgresEventStore(pool, key);
    await store.ensureSchema();
    return store;
  }

  async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS event_store (
          id          bigserial PRIMARY KEY,
          global_seq  bigserial UNIQUE NOT NULL,
          stream_id   text NOT NULL,
          event_type  text NOT NULL,
          version     int  NOT NULL,
          tenant_id   text,
          actor_id    text,
          payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
          occurred_at timestamptz NOT NULL DEFAULT now(),
          status      text NOT NULL DEFAULT 'active',
          CONSTRAINT event_store_stream_version UNIQUE (stream_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_event_store_stream ON event_store (stream_id, version);
        CREATE INDEX IF NOT EXISTS idx_event_store_type   ON event_store (event_type);
        CREATE INDEX IF NOT EXISTS idx_event_store_tenant ON event_store (tenant_id, global_seq);
        CREATE INDEX IF NOT EXISTS idx_event_store_seq    ON event_store (global_seq);
      `);
      this.schemaReady = true;
    } finally {
      client.release();
    }
  }

  async append(input: AppendEventInput): Promise<StoredEvent> {
    await this.ensureSchema();
    const unitOfWork = createPostgresUnitOfWork(this.pool);
    const stored = await unitOfWork.runInTransaction(async (client) => this.appendWithClient(client, input));

    // Notify in-process subscribers (best-effort, never blocks the caller).
    this.notifySubscribers(stored);
    return stored;
  }

  async appendWithOutbox(
    input: AppendEventInput,
    outbox: Pick<OutboxPort, "enqueue">,
    messages: OutboxEnqueueInput[]
  ): Promise<StoredEvent> {
    await this.ensureSchema();
    const unitOfWork = createPostgresUnitOfWork(this.pool);
    const stored = await unitOfWork.runInTransaction(async (client) => {
      const event = await this.appendWithClient(client, input);
      for (const message of messages) {
        await outbox.enqueue(message, { tx: client });
      }
      return event;
    });

    this.notifySubscribers(stored);
    return stored;
  }

  async read(streamId: string, options: ReadEventsOptions = {}): Promise<StoredEvent[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [streamId];
    const conditions: string[] = ["stream_id = $1", "status = 'active'"];

    if (typeof options.fromVersion === "number") {
      params.push(options.fromVersion);
      conditions.push(`version >= $${params.length}`);
    }
    if (typeof options.toVersion === "number") {
      params.push(options.toVersion);
      conditions.push(`version <= $${params.length}`);
    }

    const tenantId = options.tenantId !== undefined ? options.tenantId : currentTenantId();
    if (tenantId !== null && tenantId !== undefined) {
      params.push(tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }

    const limit = options.limit ?? 1000;
    params.push(limit);

    const result = await this.pool.query<{
      id: number | string;
      global_seq: number | string;
      stream_id: string;
      event_type: string;
      version: number | string;
      tenant_id: string | null;
      actor_id: string | null;
      payload: unknown;
      occurred_at: Date | string;
      status: string;
    }>(
      `SELECT id, global_seq, stream_id, event_type, version,
              tenant_id, actor_id, payload, occurred_at, status
       FROM event_store
       WHERE ${conditions.join(" AND ")}
       ORDER BY version ASC
       LIMIT $${params.length}`,
      params
    );

    return result.rows.map((r) => this.toStored(r));
  }

  subscribe(handler: EventHandler, options: SubscribeOptions = {}): () => void {
    const entry = { handler, options };
    this.subscribers.push(entry);
    return () => {
      const idx = this.subscribers.indexOf(entry);
      if (idx !== -1) this.subscribers.splice(idx, 1);
    };
  }

  async tombstone(id: number): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE event_store SET status = 'tombstoned', payload = '{}'::jsonb WHERE id = $1`,
      [id]
    );
  }

  private toStored(r: {
    id: number | string;
    global_seq: number | string;
    stream_id: string;
    event_type: string;
    version: number | string;
    tenant_id: string | null;
    actor_id: string | null;
    payload: unknown;
    occurred_at: Date | string;
    status: string;
  }): StoredEvent {
    const rawPayload = (typeof r.payload === "string"
      ? JSON.parse(r.payload)
      : r.payload ?? {}) as Record<string, unknown>;
    const migratedPayload = this.schemaRegistry.migrateForRead(r.event_type, rawPayload);
    return {
      id: Number(r.id),
      globalSeq: Number(r.global_seq),
      streamId: r.stream_id,
      eventType: r.event_type,
      version: Number(r.version),
      tenantId: r.tenant_id,
      actorId: r.actor_id ?? undefined,
      payload: migratedPayload,
      occurredAt:
        r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
      status: r.status === "tombstoned" ? "tombstoned" : "active"
    };
  }

  private async appendWithClient(
    client: { query: PoolClient["query"] },
    input: AppendEventInput
  ): Promise<StoredEvent> {
      const validatedPayload = this.schemaRegistry.validateForAppend(input.eventType, input.payload);

    const tenantId = input.tenantId ?? currentTenantId() ?? null;
    const occurredAt = input.occurredAt ?? new Date().toISOString();

    // Read current max version under lock to enforce optimistic concurrency.
    const versionResult = await client.query<{ max_version: number | null }>(
      `SELECT MAX(version) AS max_version FROM event_store
       WHERE stream_id = $1 FOR UPDATE`,
      [input.streamId]
    );
    const currentVersion = versionResult.rows[0]?.max_version ?? -1;
    if (currentVersion !== input.expectedVersion - 1) {
      throw new OptimisticConcurrencyError(input.streamId, input.expectedVersion, currentVersion + 1);
    }

    const insertResult = await client.query<{
      id: number;
      global_seq: number;
      occurred_at: Date | string;
    }>(
      `INSERT INTO event_store
         (stream_id, event_type, version, tenant_id, actor_id, payload, occurred_at, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, 'active')
       RETURNING id, global_seq, occurred_at`,
      [
        input.streamId,
        input.eventType,
        input.expectedVersion,
        tenantId,
        input.actorId ?? null,
        JSON.stringify(validatedPayload),
        occurredAt
      ]
    );

    const row = insertResult.rows[0]!;
    return {
      id: Number(row.id),
      globalSeq: Number(row.global_seq),
      streamId: input.streamId,
      eventType: input.eventType,
      version: input.expectedVersion,
      tenantId,
      actorId: input.actorId,
      payload: validatedPayload,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : String(row.occurred_at),
      status: "active"
    };
  }

  private notifySubscribers(event: StoredEvent): void {
    for (const { handler, options } of this.subscribers) {
      if (
        typeof options.fromGlobalSeq === "number" &&
        event.globalSeq < options.fromGlobalSeq
      ) {
        continue;
      }
      if (
        Array.isArray(options.eventTypes) &&
        options.eventTypes.length > 0 &&
        !options.eventTypes.includes(event.eventType)
      ) {
        continue;
      }
      if (options.tenantId !== undefined && options.tenantId !== event.tenantId) {
        continue;
      }
      void Promise.resolve(handler(event)).catch(() => {
        // subscriber failures must not propagate to the appender
      });
    }
  }
}

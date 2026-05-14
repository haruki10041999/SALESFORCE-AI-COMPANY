import { PgBoss } from "pg-boss";
import { Pool, type PoolClient } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "../../core/persistence/pg-pool-registry.js";
import type {
  OutboxDispatchResult,
  OutboxEnqueueInput,
  OutboxMessageRecord,
  OutboxPort
} from "../../core/ports/outbox-port.js";

interface OutboxRow {
  id: number | string;
  topic: string;
  payload: unknown;
  dedupe_key: string | null;
  available_at: Date | string;
  max_attempts: number;
  attempts: number;
  headers: unknown;
  status: "pending" | "dispatched" | "failed";
  last_error: string | null;
  created_at: Date | string;
  dispatched_at: Date | string | null;
}

export interface PgBossOutboxOptions {
  databaseUrl: string;
  queuePrefix?: string;
}

function asIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: OutboxRow): OutboxMessageRecord {
  return {
    id: Number(row.id),
    topic: row.topic,
    payload: (typeof row.payload === "string"
      ? JSON.parse(row.payload)
      : row.payload ?? {}) as Record<string, unknown>,
    dedupeKey: row.dedupe_key ?? undefined,
    availableAt: asIso(row.available_at),
    maxAttempts: Number(row.max_attempts),
    attempts: Number(row.attempts),
    headers: (typeof row.headers === "string"
      ? JSON.parse(row.headers)
      : row.headers ?? {}) as Record<string, unknown>,
    status: row.status,
    lastError: row.last_error ?? undefined,
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    dispatchedAt: asIso(row.dispatched_at)
  };
}

export class PgBossOutboxPort implements OutboxPort {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private readonly boss: PgBoss;
  private readonly queuePrefix: string;
  private schemaReady = false;

  private constructor(pool: Pool, poolKey: string, boss: PgBoss, queuePrefix: string) {
    this.pool = pool;
    this.poolKey = poolKey;
    this.boss = boss;
    this.queuePrefix = queuePrefix;
  }

  public static async open(options: PgBossOutboxOptions): Promise<PgBossOutboxPort> {
    if (!options.databaseUrl?.trim()) {
      throw new Error("DATABASE_URL is required for PgBossOutboxPort");
    }

    const normalizedUrl = options.databaseUrl.trim();
    const poolKey = `outbox:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const pool = getOrCreatePgPool(poolKey, normalizedUrl);
    const boss = new PgBoss(normalizedUrl);
    await boss.start();

    const instance = new PgBossOutboxPort(pool, poolKey, boss, options.queuePrefix ?? "outbox");
    await instance.ensureSchema();
    return instance;
  }

  public async close(): Promise<void> {
    await this.boss.stop().catch(() => {});
    await releasePgPoolKey(this.poolKey);
  }

  public async enqueue(input: OutboxEnqueueInput, options?: { tx?: unknown }): Promise<OutboxMessageRecord> {
    await this.ensureSchema();
    const client = isPoolClient(options?.tx) ? options.tx : this.pool;
    const result = await client.query<OutboxRow>(
      [
        "INSERT INTO outbox_messages(",
        "  topic, payload, dedupe_key, available_at, max_attempts, headers, status",
        ") VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5, 25), $6::jsonb, 'pending')",
        "RETURNING id, topic, payload, dedupe_key, available_at, max_attempts, attempts, headers, status, last_error, created_at, dispatched_at"
      ].join("\n"),
      [
        input.topic,
        JSON.stringify(input.payload),
        input.dedupeKey ?? null,
        input.availableAt ?? null,
        input.maxAttempts ?? 25,
        JSON.stringify(input.headers ?? {})
      ]
    );

    return toRecord(result.rows[0]!);
  }

  public async listPending(limit = 100): Promise<OutboxMessageRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<OutboxRow>(
      [
        "SELECT id, topic, payload, dedupe_key, available_at, max_attempts, attempts, headers, status, last_error, created_at, dispatched_at",
        "FROM outbox_messages",
        "WHERE status = 'pending'",
        "ORDER BY id ASC",
        "LIMIT $1"
      ].join("\n"),
      [Math.max(1, limit)]
    );
    return result.rows.map((row) => toRecord(row));
  }

  public async dispatchPending(options?: { limit?: number }): Promise<OutboxDispatchResult> {
    await this.ensureSchema();
    const limit = Math.max(1, options?.limit ?? 100);
    const client = await this.pool.connect();
    let scanned = 0;
    let dispatched = 0;
    let failed = 0;

    try {
      await client.query("BEGIN");
      const rows = await client.query<OutboxRow>(
        [
          "SELECT id, topic, payload, dedupe_key, available_at, max_attempts, attempts, headers, status, last_error, created_at, dispatched_at",
          "FROM outbox_messages",
          "WHERE status = 'pending' AND available_at <= NOW() AND attempts < max_attempts",
          "ORDER BY id ASC",
          "FOR UPDATE SKIP LOCKED",
          "LIMIT $1"
        ].join("\n"),
        [limit]
      );
      scanned = rows.rowCount ?? 0;

      for (const row of rows.rows) {
        const queueName = `${this.queuePrefix}.${row.topic}`;
        const idempotencyKey = row.dedupe_key ?? `outbox:${Number(row.id)}`;
        try {
          await this.boss.createQueue(queueName).catch(() => {});
          await this.boss.send(queueName, {
            outboxId: Number(row.id),
            topic: row.topic,
            idempotencyKey,
            payload: (typeof row.payload === "string"
              ? JSON.parse(row.payload)
              : row.payload ?? {}) as Record<string, unknown>,
            headers: {
              ...((typeof row.headers === "string"
                ? JSON.parse(row.headers)
                : row.headers ?? {}) as Record<string, unknown>),
              idempotencyKey
            }
          }, {
            singletonKey: idempotencyKey
          });

          await client.query(
            [
              "UPDATE outbox_messages",
              "SET status = 'dispatched', dispatched_at = NOW(), attempts = attempts + 1, last_error = NULL",
              "WHERE id = $1"
            ].join("\n"),
            [row.id]
          );
          dispatched += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await client.query(
            [
              "UPDATE outbox_messages",
              "SET attempts = attempts + 1,",
              "    last_error = $2,",
              "    status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,",
              "    available_at = NOW() + ((attempts + 1) * interval '30 seconds')",
              "WHERE id = $1"
            ].join("\n"),
            [row.id, message]
          );
          failed += 1;
        }
      }

      await client.query("COMMIT");
      return { scanned, dispatched, failed };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }
    await this.pool.query(
      [
        "CREATE TABLE IF NOT EXISTS outbox_messages(",
        "  id bigserial PRIMARY KEY,",
        "  topic text NOT NULL,",
        "  payload jsonb NOT NULL,",
        "  dedupe_key text,",
        "  available_at timestamptz NOT NULL DEFAULT NOW(),",
        "  max_attempts integer NOT NULL DEFAULT 25,",
        "  attempts integer NOT NULL DEFAULT 0,",
        "  headers jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  status text NOT NULL DEFAULT 'pending',",
        "  last_error text,",
        "  created_at timestamptz NOT NULL DEFAULT NOW(),",
        "  dispatched_at timestamptz",
        ")"
      ].join("\n")
    );
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS idx_outbox_messages_pending ON outbox_messages(status, available_at, id)"
    );
    await this.pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_messages_dedupe ON outbox_messages(topic, dedupe_key) WHERE dedupe_key IS NOT NULL"
    );
    this.schemaReady = true;
  }
}

function isPoolClient(value: unknown): value is PoolClient {
  return typeof value === "object" && value !== null && typeof (value as PoolClient).query === "function";
}

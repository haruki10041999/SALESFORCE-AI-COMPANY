/**
 * ReplayReader — TASK-15: Replay Debugger UI
 *
 * Read-only service that reads from the event_store table and
 * returns structured timeline / diff data for the Replay Debugger UI.
 *
 * Operates entirely over a plain pg Pool to stay decoupled from
 * the write-path PostgresEventStore.
 */

import { Pool } from "pg";
import { getOrCreatePgPool } from "./pg-pool-registry.js";

export interface ReplayEvent {
  id: number;
  globalSeq: number;
  streamId: string;
  eventType: string;
  version: number;
  tenantId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  status: "active" | "tombstoned";
}

export interface ReplayStream {
  streamId: string;
  eventCount: number;
  firstAt: string;
  lastAt: string;
}

export interface ReplayTimelineResult {
  sessionId: string;
  streams: ReplayStream[];
  events: ReplayEvent[];
}

export interface ReplayDiffEntry {
  version: number;
  eventType: string;
  occurredAt: string;
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
}

export interface ReplayDiffResult {
  streamId: string;
  diffs: ReplayDiffEntry[];
}

export interface ReplayReaderOptions {
  databaseUrl: string;
}

function diffPayloads(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): { added: Record<string, unknown>; removed: Record<string, unknown> } {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(next)) {
    if (!(k in prev)) {
      added[k] = v;
    } else if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
      added[k] = v;
      removed[k] = prev[k];
    }
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) {
      removed[k] = prev[k];
    }
  }
  return { added, removed };
}

function rowToEvent(row: Record<string, unknown>): ReplayEvent {
  return {
    id: Number(row.id),
    globalSeq: Number(row.global_seq),
    streamId: String(row.stream_id),
    eventType: String(row.event_type),
    version: Number(row.version),
    tenantId: row.tenant_id != null ? String(row.tenant_id) : null,
    actorId: row.actor_id != null ? String(row.actor_id) : null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    occurredAt: String(row.occurred_at),
    status: row.status === "tombstoned" ? "tombstoned" : "active",
  };
}

export class ReplayReader {
  private readonly pool: Pool;
  private readonly poolKey: string;

  constructor(options: ReplayReaderOptions) {
    this.poolKey = `replay-reader:${options.databaseUrl}`;
    this.pool = getOrCreatePgPool(this.poolKey, options.databaseUrl);
  }

  /**
   * List recent session-prefixed stream IDs.
   * Returns streams whose stream_id starts with `session:` (or any prefix).
   */
  async listStreams(options: {
    prefix?: string;
    tenantId?: string | null;
    limit?: number;
    since?: string;
  } = {}): Promise<ReplayStream[]> {
    const { prefix = "", tenantId, limit = 50, since } = options;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (prefix) {
      conditions.push(`stream_id LIKE $${idx++}`);
      params.push(`${prefix}%`);
    }
    if (tenantId !== undefined) {
      conditions.push(`tenant_id = $${idx++}`);
      params.push(tenantId);
    }
    if (since) {
      conditions.push(`MAX(occurred_at) >= $${idx++}`);
      params.push(since);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        stream_id,
        COUNT(*)::int  AS event_count,
        MIN(occurred_at) AS first_at,
        MAX(occurred_at) AS last_at
      FROM event_store
      ${where}
      GROUP BY stream_id
      ORDER BY last_at DESC
      LIMIT $${idx}
    `;
    params.push(limit);

    const result = await this.pool.query(sql, params);
    return result.rows.map((r: Record<string, unknown>) => ({
      streamId: String(r.stream_id),
      eventCount: Number(r.event_count),
      firstAt: String(r.first_at),
      lastAt: String(r.last_at),
    }));
  }

  /**
   * Read all events for a stream ordered by version ascending.
   * Optionally filter by tenantId and event status.
   */
  async readStream(streamId: string, options: {
    tenantId?: string | null;
    includeDeleted?: boolean;
    fromVersion?: number;
    limit?: number;
  } = {}): Promise<ReplayEvent[]> {
    const { tenantId, includeDeleted = false, fromVersion = 0, limit = 500 } = options;

    const conditions: string[] = ["stream_id = $1", "version >= $2"];
    const params: unknown[] = [streamId, fromVersion];
    let idx = 3;

    if (!includeDeleted) {
      conditions.push(`status = 'active'`);
    }
    if (tenantId !== undefined) {
      conditions.push(`tenant_id = $${idx++}`);
      params.push(tenantId);
    }

    params.push(limit);
    const sql = `
      SELECT id, global_seq, stream_id, event_type, version,
             tenant_id, actor_id, payload, occurred_at, status
      FROM event_store
      WHERE ${conditions.join(" AND ")}
      ORDER BY version ASC
      LIMIT $${idx}
    `;

    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToEvent);
  }

  /**
   * Build a full timeline for a session: all streams whose stream_id starts
   * with `session:<sessionId>`, merged and sorted by globalSeq.
   */
  async sessionTimeline(sessionId: string, options: {
    tenantId?: string | null;
    limit?: number;
  } = {}): Promise<ReplayTimelineResult> {
    const { tenantId, limit = 200 } = options;

    const conditions: string[] = ["stream_id LIKE $1", "status = 'active'"];
    const params: unknown[] = [`session:${sessionId}%`];
    let idx = 2;

    if (tenantId !== undefined) {
      conditions.push(`tenant_id = $${idx++}`);
      params.push(tenantId);
    }
    params.push(limit);

    const sql = `
      SELECT id, global_seq, stream_id, event_type, version,
             tenant_id, actor_id, payload, occurred_at, status
      FROM event_store
      WHERE ${conditions.join(" AND ")}
      ORDER BY global_seq ASC
      LIMIT $${idx}
    `;

    const result = await this.pool.query(sql, params);
    const events = result.rows.map(rowToEvent);

    // Aggregate streams
    const streamMap = new Map<string, { count: number; first: string; last: string }>();
    for (const ev of events) {
      const entry = streamMap.get(ev.streamId);
      if (!entry) {
        streamMap.set(ev.streamId, { count: 1, first: ev.occurredAt, last: ev.occurredAt });
      } else {
        entry.count += 1;
        if (ev.occurredAt < entry.first) entry.first = ev.occurredAt;
        if (ev.occurredAt > entry.last) entry.last = ev.occurredAt;
      }
    }

    const streams: ReplayStream[] = [...streamMap.entries()].map(([streamId, s]) => ({
      streamId,
      eventCount: s.count,
      firstAt: s.first,
      lastAt: s.last,
    }));

    return { sessionId, streams, events };
  }

  /**
   * Compute per-event payload diffs for a stream (successive state changes).
   */
  async streamDiff(streamId: string, options: {
    tenantId?: string | null;
  } = {}): Promise<ReplayDiffResult> {
    const events = await this.readStream(streamId, { tenantId: options.tenantId, limit: 1000 });

    const diffs: ReplayDiffEntry[] = [];
    let prev: Record<string, unknown> = {};

    for (const ev of events) {
      const { added, removed } = diffPayloads(prev, ev.payload);
      diffs.push({
        version: ev.version,
        eventType: ev.eventType,
        occurredAt: ev.occurredAt,
        added,
        removed,
      });
      // Merge payload for next iteration (simple last-write-wins projection)
      prev = { ...prev, ...ev.payload };
    }

    return { streamId, diffs };
  }

  static create(options: ReplayReaderOptions): ReplayReader {
    return new ReplayReader(options);
  }
}

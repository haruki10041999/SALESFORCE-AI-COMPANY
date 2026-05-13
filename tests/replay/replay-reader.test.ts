/**
 * Tests for ReplayReader and register-replay-tools (TASK-15).
 *
 * Uses an in-memory stub for pg Pool so no real DB is required.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ReplayReader } from "../../mcp/core/persistence/replay-reader.js";
import { registerReplayTools } from "../../mcp/handlers/register-replay-tools.js";

// ---------------------------------------------------------------------------
// Pool stub
// ---------------------------------------------------------------------------

interface Row {
  id: number;
  global_seq: number;
  stream_id: string;
  event_type: string;
  version: number;
  tenant_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  status: string;
}

const ROWS: Row[] = [
  {
    id: 1, global_seq: 1, stream_id: "session:abc:agent", event_type: "agent.started",
    version: 0, tenant_id: "t1", actor_id: "user:alice", payload: { step: 1 },
    occurred_at: "2026-05-13T10:00:00.000Z", status: "active",
  },
  {
    id: 2, global_seq: 2, stream_id: "session:abc:agent", event_type: "agent.message",
    version: 1, tenant_id: "t1", actor_id: "agent:qa", payload: { step: 2, message: "hello" },
    occurred_at: "2026-05-13T10:00:05.000Z", status: "active",
  },
  {
    id: 3, global_seq: 3, stream_id: "session:abc:agent", event_type: "agent.finished",
    version: 2, tenant_id: "t1", actor_id: "agent:qa", payload: { step: 3, result: "done" },
    occurred_at: "2026-05-13T10:00:10.000Z", status: "active",
  },
  {
    id: 4, global_seq: 4, stream_id: "other:xyz", event_type: "x.event",
    version: 0, tenant_id: null, actor_id: null, payload: {},
    occurred_at: "2026-05-13T10:01:00.000Z", status: "tombstoned",
  },
];

function queryStub(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> {
  // listStreams query (GROUP BY stream_id)
  if (sql.includes("GROUP BY stream_id")) {
    const raw = params?.[0];
    const prefix = typeof raw === "string" ? raw.replace(/%$/, "") : "";
    const grouped = new Map<string, { count: number; first: string; last: string }>();
    for (const row of ROWS) {
      if (prefix && !row.stream_id.startsWith(prefix)) continue;
      const e = grouped.get(row.stream_id);
      if (!e) grouped.set(row.stream_id, { count: 1, first: row.occurred_at, last: row.occurred_at });
      else { e.count += 1; if (row.occurred_at > e.last) e.last = row.occurred_at; }
    }
    const rows = [...grouped.entries()].map(([stream_id, g]) => ({
      stream_id, event_count: g.count, first_at: g.first, last_at: g.last,
    })) as unknown as Row[];
    return Promise.resolve({ rows });
  }

  // readStream / sessionTimeline — filter by stream_id prefix or exact
  let filtered = ROWS.filter((r) => r.status === "active");

  // stream_id LIKE $1
  const likeIdx = sql.indexOf("stream_id LIKE");
  if (likeIdx >= 0 && params?.[0]) {
    const prefix = String(params[0]).replace(/%$/, "");
    filtered = filtered.filter((r) => r.stream_id.startsWith(prefix));
  }

  // stream_id = $1
  if (sql.includes("stream_id = $1") && params?.[0]) {
    filtered = filtered.filter((r) => r.stream_id === params[0]);
  }

  // version >= $2
  if (sql.includes("version >= $2") && params?.[1] !== undefined) {
    filtered = filtered.filter((r) => r.version >= Number(params[1]));
  }

  // ORDER BY global_seq or version
  if (sql.includes("ORDER BY global_seq")) {
    filtered = filtered.slice().sort((a, b) => a.global_seq - b.global_seq);
  } else {
    filtered = filtered.slice().sort((a, b) => a.version - b.version);
  }

  const limitParam = params?.find((_, i) => i === params.length - 1);
  const limit = typeof limitParam === "number" ? limitParam : 500;
  return Promise.resolve({ rows: filtered.slice(0, limit) });
}

// ---------------------------------------------------------------------------
// Inject stub pool via module augmentation workaround:
// ReplayReader.create uses getOrCreatePgPool — we test via the reader directly
// by overriding the pool's query method through a subclass.
// ---------------------------------------------------------------------------

class StubReplayReader extends ReplayReader {
  constructor() {
    super({ databaseUrl: "postgres://stub:stub@localhost/stub" });
    // Override the pool with our stub
    (this as unknown as { pool: { query: typeof queryStub } }).pool = { query: queryStub };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReplayReader", () => {
  let reader: StubReplayReader;

  before(() => {
    reader = new StubReplayReader();
  });

  it("listStreams returns all streams when no prefix given", async () => {
    const streams = await reader.listStreams({ limit: 10 });
    assert.ok(streams.length >= 1);
  });

  it("listStreams filters by prefix", async () => {
    const streams = await reader.listStreams({ prefix: "session:", limit: 10 });
    assert.ok(streams.every((s) => s.streamId.startsWith("session:")));
  });

  it("readStream returns events ordered by version", async () => {
    const events = await reader.readStream("session:abc:agent");
    assert.ok(events.length >= 2);
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i]!.version >= events[i - 1]!.version);
    }
  });

  it("readStream fromVersion excludes earlier versions", async () => {
    const events = await reader.readStream("session:abc:agent", { fromVersion: 1 });
    assert.ok(events.every((e) => e.version >= 1));
  });

  it("sessionTimeline groups streams", async () => {
    const result = await reader.sessionTimeline("abc");
    assert.equal(result.sessionId, "abc");
    assert.ok(result.streams.length >= 1);
    assert.ok(result.events.length >= 1);
  });

  it("streamDiff returns one diff per event", async () => {
    const result = await reader.streamDiff("session:abc:agent");
    assert.equal(result.streamId, "session:abc:agent");
    assert.ok(result.diffs.length >= 1);
    // First event diff: no removals (empty prev)
    assert.deepEqual(result.diffs[0]!.removed, {});
    // Second event: added new keys
    const secondDiff = result.diffs[1]!;
    assert.ok("message" in secondDiff.added || "step" in secondDiff.added || "step" in secondDiff.removed);
  });

  it("streamDiff removed shows old values on overwrite", async () => {
    const result = await reader.streamDiff("session:abc:agent");
    // step changes from 1 → 2 → 3, so removed should contain old step value
    const secondDiff = result.diffs[1]!;
    assert.ok("step" in secondDiff.removed, "overwritten 'step' should appear in removed");
  });
});

describe("registerReplayTools (no DB)", () => {
  type Handler = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

  it("tools register without error when databaseUrl is absent", () => {
    const registered: string[] = [];
    const govTool = (name: string, _schema: unknown, _handler: unknown) => { registered.push(name); };
    registerReplayTools({ govTool: govTool as never, databaseUrl: undefined });
    assert.ok(registered.includes("replay_timeline"), "replay_timeline should be registered");
    assert.ok(registered.includes("replay_list_streams"), "replay_list_streams should be registered");
    assert.ok(registered.includes("replay_stream_events"), "replay_stream_events should be registered");
    assert.ok(registered.includes("replay_stream_diff"), "replay_stream_diff should be registered");
  });

  it("replay_timeline tool returns error message when no databaseUrl", async () => {
    let capturedHandler: Handler | null = null;
    const govTool = (name: string, _schema: unknown, handler: unknown) => {
      if (name === "replay_timeline") {
        capturedHandler = handler as typeof capturedHandler;
      }
    };
    registerReplayTools({ govTool: govTool as never, databaseUrl: undefined });
    assert.ok(capturedHandler);
    const result = await (capturedHandler as Handler)({ sessionId: "test" });
    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    assert.ok(parsed.error.includes("DATABASE_URL"));
  });
});

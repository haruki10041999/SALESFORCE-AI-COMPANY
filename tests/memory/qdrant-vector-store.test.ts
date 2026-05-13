/**
 * Tests for QdrantVectorStore (TASK-13).
 *
 * The tests use a fetch mock to avoid requiring a live Qdrant instance.
 * All Qdrant REST calls are intercepted and replaced with in-memory stubs.
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { QdrantVectorStore } from "../../mcp/core/memory/qdrant-vector-store.js";

// ---------------------------------------------------------------------------
// Minimal in-memory Qdrant stub
// ---------------------------------------------------------------------------

interface StoredPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

class QdrantStub {
  collections = new Map<string, StoredPoint[]>();

  handle(url: string, init?: RequestInit): Response {
    const u = new URL(url);
    const pathParts = u.pathname.split("/").filter(Boolean);
    const method = (init?.method ?? "GET").toUpperCase();

    // GET /collections/:name
    if (method === "GET" && pathParts[0] === "collections" && pathParts.length === 2) {
      const col = pathParts[1];
      return this.json(this.collections.has(col) ? { status: "ok" } : null, this.collections.has(col) ? 200 : 404);
    }

    // PUT /collections/:name  (create)
    if (method === "PUT" && pathParts[0] === "collections" && pathParts.length === 2) {
      const col = pathParts[1];
      if (!this.collections.has(col)) this.collections.set(col, []);
      return this.json({ result: true, status: "ok" });
    }

    // DELETE /collections/:name  (clear)
    if (method === "DELETE" && pathParts[0] === "collections" && pathParts.length === 2) {
      const col = pathParts[1];
      this.collections.delete(col);
      return this.json({ result: true, status: "ok" });
    }

    // PUT /collections/:name/points  (upsert)
    if (method === "PUT" && pathParts[2] === "points") {
      const col = pathParts[1];
      const body = JSON.parse((init?.body as string) ?? "{}") as { points: StoredPoint[] };
      const store = this.collections.get(col) ?? [];
      for (const p of body.points) {
        const idx = store.findIndex((s) => s.id === p.id);
        if (idx >= 0) store[idx] = p; else store.push(p);
      }
      this.collections.set(col, store);
      return this.json({ result: { operation_id: 0, status: "completed" } });
    }

    // POST /collections/:name/points/delete
    if (method === "POST" && pathParts[2] === "points" && pathParts[3] === "delete") {
      const col = pathParts[1];
      const body = JSON.parse((init?.body as string) ?? "{}") as { points: string[] };
      const store = (this.collections.get(col) ?? []).filter((p) => !body.points.includes(p.id));
      this.collections.set(col, store);
      return this.json({ result: { operation_id: 0, status: "completed" } });
    }

    // POST /collections/:name/points/search
    if (method === "POST" && pathParts[2] === "points" && pathParts[3] === "search") {
      const col = pathParts[1];
      const body = JSON.parse((init?.body as string) ?? "{}") as { vector: number[]; limit: number; score_threshold?: number };
      const store = this.collections.get(col) ?? [];
      const scored = store
        .map((p) => ({ id: p.id, score: this.cosine(p.vector, body.vector), payload: p.payload }))
        .filter((p) => body.score_threshold == null || p.score >= body.score_threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, body.limit);
      return this.json({ result: scored });
    }

    // GET /collections/:name/points/:id
    if (method === "GET" && pathParts[2] === "points" && pathParts.length === 4) {
      const col = pathParts[1];
      const id = pathParts[3];
      const point = (this.collections.get(col) ?? []).find((p) => p.id === id);
      if (!point) return this.json(null, 404);
      return this.json({ result: point });
    }

    return this.json({ error: "not matched" }, 404);
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0; let normA = 0; let normB = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i] * b[i];
      normA += a[i] ** 2;
      normB += b[i] ** 2;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// ---------------------------------------------------------------------------
// Install / restore the global fetch mock
// ---------------------------------------------------------------------------

let stub: QdrantStub;
const originalFetch = globalThis.fetch;

function installMock(): void {
  stub = new QdrantStub();
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return Promise.resolve(stub.handle(String(input), init));
  };
}

function restoreMock(): void {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(dim = 4): QdrantVectorStore {
  return new QdrantVectorStore({ url: "http://qdrant-stub", collection: "test", dimension: dim });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QdrantVectorStore", () => {
  before(() => installMock());

  afterEach(() => {
    stub.collections.clear();
  });

  it("upserts a record", async () => {
    const store = makeStore();
    await store.upsert({ id: "r1", text: "hello world", vector: [1, 0, 0, 0] });
    const col = stub.collections.get("test") ?? [];
    assert.equal(col.length, 1);
    assert.equal(col[0].id, "r1");
    assert.equal(col[0].payload.text, "hello world");
    restoreMock();
    installMock();
  });

  it("replaces an existing record on upsert", async () => {
    const store = makeStore();
    await store.upsert({ id: "r1", text: "first", vector: [1, 0, 0, 0] });
    await store.upsert({ id: "r1", text: "second", vector: [0, 1, 0, 0] });
    const col = stub.collections.get("test") ?? [];
    assert.equal(col.length, 1);
    assert.equal(col[0].payload.text, "second");
  });

  it("deletes a record", async () => {
    const store = makeStore();
    await store.upsert({ id: "r1", text: "hello", vector: [1, 0, 0, 0] });
    await store.delete("r1");
    const col = stub.collections.get("test") ?? [];
    assert.equal(col.length, 0);
  });

  it("get returns the record if it exists", async () => {
    const store = makeStore();
    await store.upsert({ id: "r2", text: "found me", vector: [0, 1, 0, 0] });
    const rec = await store.get("r2");
    assert.ok(rec);
    assert.equal(rec.text, "found me");
  });

  it("get returns undefined for missing record", async () => {
    const store = makeStore();
    const rec = await store.get("does-not-exist");
    assert.equal(rec, undefined);
  });

  it("query returns scored results ordered by similarity", async () => {
    const store = makeStore();
    await store.upsert({ id: "a", text: "apple", vector: [1, 0, 0, 0] });
    await store.upsert({ id: "b", text: "banana", vector: [0, 1, 0, 0] });
    // Query with a vector similar to "a"
    const results = await store.query("apple", { limit: 2 });
    assert.equal(results.length >= 1, true);
    // First result should be "a" (highest similarity)
    assert.equal(results[0].record.id, "a");
  });

  it("query respects limit", async () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) {
      await store.upsert({ id: `r${i}`, text: `record ${i}`, vector: [i, 0, 0, 0] });
    }
    const results = await store.query("record", { limit: 2 });
    assert.ok(results.length <= 2);
  });

  it("clear removes all records", async () => {
    const store = makeStore();
    await store.upsert({ id: "r1", text: "a", vector: [1, 0, 0, 0] });
    await store.clear();
    assert.equal(stub.collections.has("test"), false);
  });

  it("QdrantVectorStore.create is a factory helper", () => {
    const store = QdrantVectorStore.create({ url: "http://qdrant-stub", collection: "test", dimension: 4 });
    assert.ok(store instanceof QdrantVectorStore);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonlVectorStoreAdapter } from "../memory/adapters/jsonl-vector-store.js";

// Reach into the private cache for behavioral verification only.
type AdapterInternals = {
  records: import("../memory/vector-store-adapter.js").MemoryRecord[];
  embeddingProvider: {
    _peekCacheFingerprint?: (
      records: import("../memory/vector-store-adapter.js").MemoryRecord[]
    ) => string | undefined;
  };
};

function makeAdapter(): { adapter: JsonlVectorStoreAdapter; cleanup: () => void } {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-tfidf-cache-"));
  const adapter = new JsonlVectorStoreAdapter();
  adapter.configureStorageForTest(join(tempRoot, "vector-store.jsonl"));
  adapter.clearRecords();
  return {
    adapter,
    cleanup: () => rmSync(tempRoot, { recursive: true, force: true })
  };
}

test("TfidfEmbeddingProvider: results are stable across repeated searches (cache hit)", () => {
  const { adapter, cleanup } = makeAdapter();
  try {
    adapter.addRecord({ id: "a", text: "apex trigger bulk pattern", tags: ["apex"] });
    adapter.addRecord({ id: "b", text: "lwc rendering performance", tags: ["lwc"] });
    adapter.addRecord({ id: "c", text: "flow approval routing", tags: ["flow"] });

    const first = adapter.searchByKeyword("apex pattern").map((r) => r.id);
    const second = adapter.searchByKeyword("apex pattern").map((r) => r.id);
    assert.deepEqual(second, first);
    assert.ok(first.includes("a"));
  } finally {
    cleanup();
  }
});

test("TfidfEmbeddingProvider: cache invalidates when a new record is added", () => {
  const { adapter, cleanup } = makeAdapter();
  try {
    adapter.addRecord({ id: "x", text: "salesforce metadata diff", tags: [] });
    const before = adapter.searchByKeyword("encryption").map((r) => r.id);
    assert.deepEqual(before, []);

    adapter.addRecord({ id: "y", text: "shield platform encryption guidance", tags: ["security"] });
    const after = adapter.searchByKeyword("encryption").map((r) => r.id);
    assert.ok(after.includes("y"), `expected new record y to surface, got ${JSON.stringify(after)}`);
  } finally {
    cleanup();
  }
});

test("TfidfEmbeddingProvider: empty query and empty store short-circuit safely", () => {
  const { adapter, cleanup } = makeAdapter();
  try {
    assert.deepEqual(adapter.searchByKeyword(""), []);
    assert.deepEqual(adapter.searchByKeyword("anything"), []);
    adapter.addRecord({ id: "z", text: "documentation writer skill", tags: [] });
    assert.deepEqual(adapter.searchByKeyword("   "), []);
  } finally {
    cleanup();
  }
});

test("TfidfEmbeddingProvider: cache fingerprint is populated after a search", () => {
  const { adapter, cleanup } = makeAdapter();
  try {
    adapter.addRecord({ id: "f1", text: "governance disable rule", tags: [] });
    const internals = adapter as unknown as AdapterInternals;
    const before = internals.embeddingProvider._peekCacheFingerprint?.(internals.records);
    assert.equal(before, undefined, "no fingerprint before any search");

    adapter.searchByKeyword("governance");
    const after = internals.embeddingProvider._peekCacheFingerprint?.(internals.records);
    assert.ok(typeof after === "string" && after.length > 0, "fingerprint should be cached after search");
  } finally {
    cleanup();
  }
});

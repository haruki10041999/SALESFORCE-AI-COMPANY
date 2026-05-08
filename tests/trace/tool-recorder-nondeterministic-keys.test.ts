import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalValue, normalizeForHash } from "../../mcp/core/trace/canonical-hash.js";

test("canonical hash ignores configured nondeterministic keys", () => {
  const first = {
    topic: "runtime",
    requestId: "req-1",
    nested: { now: "2025-01-01T00:00:00.000Z" },
    __nondeterministic: ["requestId", "nested.now"]
  };
  const second = {
    topic: "runtime",
    requestId: "req-2",
    nested: { now: "2025-02-01T00:00:00.000Z" },
    __nondeterministic: ["requestId", "nested.now"]
  };

  assert.equal(hashCanonicalValue(first), hashCanonicalValue(second));
  assert.deepEqual(normalizeForHash(first), { topic: "runtime", nested: {} });
});
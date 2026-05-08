import assert from "node:assert/strict";
import test from "node:test";
import { AdvisoryLockManager } from "../mcp/core/persistence/advisory-lock.js";

test("AdvisoryLockManager: no databaseUrl behaves as no-op lock", async () => {
  const lock = AdvisoryLockManager.open({ databaseUrl: undefined });
  let called = false;

  const result = await lock.withLock("k1", async () => {
    called = true;
    return 42;
  });

  assert.equal(called, true);
  assert.equal(result, 42);
});

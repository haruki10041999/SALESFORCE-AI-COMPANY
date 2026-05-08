import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promises as fsPromises } from "node:fs";
import {
  activateDriftFreeze,
  clearDriftFreeze,
  isDriftFreezeStateActive,
  loadDriftFreezeState,
  loadDriftFreezeStateSync
} from "../../mcp/core/learning/drift-freeze.js";

test("activateDriftFreeze persists freeze state", async () => {
  const statePath = join(tmpdir(), `drift-freeze-${Date.now()}.json`);
  try {
    const state = await activateDriftFreeze({
      reason: "test drift",
      sourceReportId: "report-1",
      durationHours: 1,
      statePath
    });

    assert.equal(state.frozen, true);
    assert.equal(state.sourceReportId, "report-1");
    assert.ok(typeof state.expiresAt === "string");

    const loaded = await loadDriftFreezeState(statePath);
    assert.ok(loaded);
    assert.equal(loaded?.frozen, true);
    assert.equal(loaded?.sourceReportId, "report-1");

    const loadedSync = loadDriftFreezeStateSync(statePath);
    assert.ok(loadedSync);
    assert.equal(loadedSync?.frozen, true);
  } finally {
    await clearDriftFreeze(statePath);
  }
});

test("isDriftFreezeStateActive respects expiry", async () => {
  const now = Date.now();
  const active = {
    frozen: true,
    reason: "active",
    triggeredAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    updatedAt: new Date(now - 60_000).toISOString()
  };
  const expired = {
    frozen: true,
    reason: "expired",
    triggeredAt: new Date(now - 120_000).toISOString(),
    expiresAt: new Date(now - 1_000).toISOString(),
    updatedAt: new Date(now - 120_000).toISOString()
  };

  assert.equal(isDriftFreezeStateActive(active, now), true);
  assert.equal(isDriftFreezeStateActive(expired, now), false);
  assert.equal(isDriftFreezeStateActive(null, now), false);
});

test("clearDriftFreeze removes persisted state", async () => {
  const statePath = join(tmpdir(), `drift-freeze-${Date.now()}.json`);
  await activateDriftFreeze({ reason: "cleanup", statePath });
  await clearDriftFreeze(statePath);

  await assert.rejects(async () => fsPromises.readFile(statePath, "utf-8"));
});

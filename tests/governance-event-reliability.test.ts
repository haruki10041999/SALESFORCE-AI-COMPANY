import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildDefaultGovernanceState,
  loadGovernanceState,
  saveGovernanceState
} from "../mcp/core/governance/governance-state.js";
import { EventDispatcher, type SystemEvent } from "../mcp/core/event/event-dispatcher.js";

test("Governance state save/load remains valid under concurrent writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-state-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const state = await loadGovernanceState(governanceFile, async () => undefined, ["protected-tool"]);
    assert.ok(state.config, "Initial state should be created");

    const writes = Array.from({ length: 20 }).map(async (_, idx) => {
      const next = buildDefaultGovernanceState(["protected-tool"]);
      next.usage.tools[`tool-${idx}`] = idx;
      await saveGovernanceState(governanceFile, next);
    });

    await Promise.all(writes);

    const raw = await readFile(governanceFile, "utf-8");
    const parsed = JSON.parse(raw) as { usage: { tools: Record<string, number> }; updatedAt: string };

    assert.ok(parsed.usage.tools, "Saved file should be valid JSON with tools usage");
    assert.ok(typeof parsed.updatedAt === "string" && parsed.updatedAt.length > 0, "updatedAt should exist");

    const files = await readdir(dir);
    const tempFiles = files.filter((name) => name.includes(".tmp"));
    assert.equal(tempFiles.length, 0, "Temporary files should be cleaned up");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Governance state load removes stale temp files from prior interrupted writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-state-stale-"));
  const governanceFile = join(dir, "governance-state.json");
  const staleTempFile = join(dir, ".governance-state.json.1234.5678.tmp");

  try {
    await readFile(staleTempFile, "utf-8").catch(async () => {
      await import("node:fs/promises").then(({ writeFile }) => writeFile(staleTempFile, "stale", "utf-8"));
    });

    const state = await loadGovernanceState(governanceFile, async () => undefined, ["protected-tool"]);
    assert.ok(state.config, "State should still load successfully");

    const files = await readdir(dir);
    assert.ok(files.includes("governance-state.json"), "Governance file should be created");
    assert.ok(!files.includes(".governance-state.json.1234.5678.tmp"), "Stale temp file should be removed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EventDispatcher disables listener after repeated failures", async () => {
  const dispatcher = new EventDispatcher();
  let failingListenerCalls = 0;
  let healthyListenerCalls = 0;

  dispatcher.on("resource_created", async () => {
    failingListenerCalls += 1;
    throw new Error("listener failure");
  });

  dispatcher.on("resource_created", async () => {
    healthyListenerCalls += 1;
  });

  const event: SystemEvent = {
    type: "resource_created",
    timestamp: new Date().toISOString(),
    payload: { name: "test" }
  };

  await dispatcher.emit(event);
  await dispatcher.emit(event);
  await dispatcher.emit(event);
  await dispatcher.emit(event);

  const stats = dispatcher.getListenerFailureStats("resource_created");
  assert.ok(stats.length >= 1, "Failure stats should be recorded");

  const failed = stats[0];
  assert.equal(failed.failureCount, 3, "Failing listener should stop at 3 failures");
  assert.equal(failed.disabled, true, "Failing listener should be disabled");
  assert.equal(failingListenerCalls, 3, "Failing listener should not run after disable");
  assert.equal(healthyListenerCalls, 4, "Healthy listener should continue running");
});

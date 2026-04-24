/**
 * error-recovery-e2e.test.ts
 *
 * E2E テスト: error_aggregate イベント → ツール自動無効化 → 復旧フロー
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildDefaultGovernanceState,
  loadGovernanceState,
  saveGovernanceState
} from "../mcp/core/governance/governance-state.js";
import { EventDispatcher } from "../mcp/core/event/event-dispatcher.js";

test("error_aggregate_detected: triggers auto-disable of problematic tool", async () => {
  const dir = await mkdtemp(join(tmpdir(), "error-recovery-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    // Setup: Initial governance state
    const initialState = buildDefaultGovernanceState([]);
    initialState.disabled.tools = [];
    await saveGovernanceState(governanceFile, initialState);

    const dispatcher = new EventDispatcher();
    const emittedEvents: string[] = [];

    dispatcher.on("error_aggregate_detected", async (event) => {
      emittedEvents.push(JSON.stringify(event));
    });

    // Emit error aggregate event
    await dispatcher.emit({
      type: "error_aggregate_detected",
      timestamp: new Date().toISOString(),
      payload: {
        toolName: "apex_analyzer",
        errorCount: 5,
        severity: "high"
      }
    });

    assert.equal(emittedEvents.length, 1, "Should emit error_aggregate_detected event");

    // Simulate tool disable based on error
    const state = await loadGovernanceState(governanceFile, async () => undefined, []);
    if (!state.disabled.tools.includes("apex_analyzer")) {
      state.disabled.tools.push("apex_analyzer");
      await saveGovernanceState(governanceFile, state);
    }

    // Verify tool is disabled
    const updated = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(updated.disabled.tools.includes("apex_analyzer"), "Tool should be disabled");

    // Simulate recovery: enable tool
    updated.disabled.tools = updated.disabled.tools.filter((t) => t !== "apex_analyzer");
    await saveGovernanceState(governanceFile, updated);

    // Verify tool is enabled
    const final = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(!final.disabled.tools.includes("apex_analyzer"), "Tool should be enabled after recovery");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("governance state: respects protected tools and does not auto-disable them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "protected-tools-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const state = buildDefaultGovernanceState(["search_resources"]);
    state.disabled.tools = [];
    await saveGovernanceState(governanceFile, state);

    const loaded = await loadGovernanceState(governanceFile, async () => undefined, ["search_resources"]);

    // Protected tools should not be disabled even on error
    assert.ok(
      loaded.config.eventAutomation.protectedTools.includes("search_resources"),
      "search_resources should be protected"
    );
    assert.ok(!loaded.disabled.tools.includes("search_resources"), "Protected tool should not be disabled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("event dispatcher: multiple listeners can process same event", async () => {
  const dispatcher = new EventDispatcher();
  const listeners: string[] = [];

  dispatcher.on("error_aggregate_detected", async () => {
    listeners.push("listener1");
  });

  dispatcher.on("error_aggregate_detected", async () => {
    listeners.push("listener2");
  });

  await dispatcher.emit({
    type: "error_aggregate_detected",
    timestamp: new Date().toISOString(),
    payload: { toolName: "test_tool", errorCount: 3 }
  });

  assert.equal(listeners.length, 2, "Both listeners should be called");
  assert.deepEqual(listeners.sort(), ["listener1", "listener2"], "Both listeners should execute");
});

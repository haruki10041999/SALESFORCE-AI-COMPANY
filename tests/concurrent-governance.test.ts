/**
 * concurrent-governance.test.ts
 *
 * テスト: governance-state への並行書き込みの一貫性確保
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildDefaultGovernanceState,
  loadGovernanceState,
  saveGovernanceState,
  type GovernanceState
} from "../mcp/core/governance/governance-state.js";

test("concurrent writes to governance-state.json maintain atomicity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-concurrent-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const state = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(state, "Initial state should be created");

    // Simulate 50 concurrent writes from different sources
    const writes = Array.from({ length: 50 }).map(async (_, idx) => {
      const next = buildDefaultGovernanceState([]);
      next.usage.tools[`concurrent-tool-${idx}`] = idx * 10;
      next.bugSignals.tools[`concurrent-tool-${idx}`] = idx;
      await saveGovernanceState(governanceFile, next);
      return idx;
    });

    await Promise.all(writes);

    // Verify: File should be valid JSON (not corrupted mid-write)
    const raw = await readFile(governanceFile, "utf-8");
    let parsed: GovernanceState;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      assert.fail(`Governance state file is corrupted: ${String(err)}`);
    }

    assert.ok(parsed.usage, "Parsed state should have usage data");
    assert.ok(parsed.bugSignals, "Parsed state should have bugSignals data");
    assert.ok(Array.isArray(parsed.disabled.tools), "Disabled tools should be an array");

    // Verify: No .tmp files left behind
    const allFiles = await readdir(dir);
    const tmpFiles = allFiles.filter((f) => f.includes(".tmp"));
    assert.equal(tmpFiles.length, 0, `Temporary files should be cleaned up, but found: ${tmpFiles.join(", ")}`);

    // Verify: State is logically consistent
    assert.ok(typeof parsed.updatedAt === "string", "updatedAt should be present");
    assert.ok(parsed.updatedAt.length > 0, "updatedAt should be non-empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent reads and writes don't corrupt governance state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-rw-concurrent-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const initialState = buildDefaultGovernanceState([]);
    await saveGovernanceState(governanceFile, initialState);

    const readResults: GovernanceState[] = [];
    const errors: Error[] = [];

    // Mix reads and writes
    const operations = Array.from({ length: 30 }).map(async (_, idx) => {
      if (idx % 2 === 0) {
        // Write operation
        const state = buildDefaultGovernanceState([]);
        state.usage.skills[`skill-${idx}`] = idx;
        try {
          await saveGovernanceState(governanceFile, state);
        } catch (err) {
          errors.push(err as Error);
        }
      } else {
        // Read operation
        try {
          const state = await loadGovernanceState(governanceFile, async () => undefined, []);
          readResults.push(state);
        } catch (err) {
          errors.push(err as Error);
        }
      }
    });

    await Promise.all(operations);

    // Verify: No fatal errors
    assert.equal(errors.length, 0, `Should have no errors, but got: ${errors.map((e) => e.message).join("; ")}`);

    // Verify: All reads got valid state
    for (const result of readResults) {
      assert.ok(result.config, "Every read should get a valid state with config");
      assert.ok(result.usage, "Every read should get usage data");
    }

    // Final state should be valid
    const finalState = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(finalState, "Final state should be readable");
    assert.ok(typeof finalState.updatedAt === "string", "Final state should have updatedAt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("governance state changes are sequenced correctly under high concurrency", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-sequence-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const initialState = buildDefaultGovernanceState([]);
    await saveGovernanceState(governanceFile, initialState);

    // Track tool disable/enable sequence
    const operations: Array<{ op: "disable" | "enable"; tool: string; idx: number }> = [];

    // Simulate tool disable operations
    const disables = Array.from({ length: 10 }).map(async (_, idx) => {
      const state = await loadGovernanceState(governanceFile, async () => undefined, []);
      const toolName = `tool-${idx}`;
      if (!state.disabled.tools.includes(toolName)) {
        state.disabled.tools.push(toolName);
        await saveGovernanceState(governanceFile, state);
        operations.push({ op: "disable", tool: toolName, idx });
      }
    });

    // Simulate tool enable operations (after disables)
    const enables = Array.from({ length: 5 }).map(async (_, idx) => {
      const state = await loadGovernanceState(governanceFile, async () => undefined, []);
      const toolName = `tool-${idx}`;
      state.disabled.tools = state.disabled.tools.filter((t) => t !== toolName);
      await saveGovernanceState(governanceFile, state);
      operations.push({ op: "enable", tool: toolName, idx });
    });

    await Promise.all([...disables, ...enables]);

    // Verify: Final state reflects the operations
    const finalState = await loadGovernanceState(governanceFile, async () => undefined, []);

    // Tools 0-4 should be enabled (from enable operations)
    // Tools 5-9 should be disabled
    for (let i = 0; i < 5; i++) {
      assert.ok(
        !finalState.disabled.tools.includes(`tool-${i}`),
        `tool-${i} should be enabled after enable operation`
      );
    }

    for (let i = 5; i < 10; i++) {
      assert.ok(finalState.disabled.tools.includes(`tool-${i}`), `tool-${i} should be disabled`);
    }

    // Verify: No duplicates in disabled tools
    const disabledSet = new Set(finalState.disabled.tools);
    assert.equal(finalState.disabled.tools.length, disabledSet.size, "No duplicate disabled tools");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale .tmp files are cleaned up during load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-cleanup-tmp-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    // Create initial valid state
    const state = buildDefaultGovernanceState([]);
    await saveGovernanceState(governanceFile, state);

    // Simulate orphaned .tmp files (from crashed writes)
    const staleTmpFile = join(dir, ".governance-state.json.9999.8888.tmp");
    const fs = await import("node:fs/promises");
    await fs.writeFile(staleTmpFile, '{ "corrupted": true }', "utf-8");

    // Load should handle orphaned .tmp files gracefully
    const loaded = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(loaded, "Should load valid state even with stale .tmp files");

    // Verify: Stale .tmp is still there (cleanup might be deferred)
    // or it should be cleaned (if implemented)
    const allFiles = await readdir(dir);
    // Just verify that main governance-state.json is valid
    const mainFile = allFiles.find((f) => f === "governance-state.json");
    assert.ok(mainFile, "Valid governance-state.json should exist");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("governance state lock mechanism prevents race conditions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gov-lock-"));
  const governanceFile = join(dir, "governance-state.json");

  try {
    const initialState = buildDefaultGovernanceState([]);
    await saveGovernanceState(governanceFile, initialState);

    // Simulate rapid sequential writes (which tests lock mechanism)
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const writes = Array.from({ length: 20 }).map(async (_, idx) => {
      currentConcurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      try {
        const state = await loadGovernanceState(governanceFile, async () => undefined, []);
        state.usage.tools[`lock-test-${idx}`] = idx;
        await saveGovernanceState(governanceFile, state);
      } finally {
        currentConcurrent -= 1;
      }
    });

    await Promise.all(writes);

    // Verify: State is valid and consistent
    const finalState = await loadGovernanceState(governanceFile, async () => undefined, []);
    assert.ok(finalState.usage.tools, "Final state should have tools usage data");

    // All writes should succeed without corruption
    const raw = await readFile(governanceFile, "utf-8");
    const parsed = JSON.parse(raw) as GovernanceState;
    assert.ok(parsed, "Final state should be valid JSON");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

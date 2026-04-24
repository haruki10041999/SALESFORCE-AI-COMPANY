import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDefaultGovernanceState,
  loadGovernanceState
} from "../mcp/core/governance/governance-state.js";
import { simulateGovernanceChange } from "../mcp/tools/simulate-governance-change.js";
import {
  formatErrorMessage,
  isRetryableByCode,
  isRetryableError,
  readErrorCode,
  toErrorMessage
} from "../mcp/core/errors/tool-error.js";

test("loadGovernanceState falls back to defaults when persisted schema is invalid", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-governance-"));
  const governanceFile = join(root, "resource-governance.json");
  const defaultProtectedTools = ["apply_resource_actions"];

  await writeFile(
    governanceFile,
    JSON.stringify({
      config: {
        maxCounts: {
          skills: "bad"
        }
      }
    }),
    "utf-8"
  );

  const state = await loadGovernanceState(
    governanceFile,
    async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    defaultProtectedTools
  );

  const expected = buildDefaultGovernanceState(defaultProtectedTools);
  assert.deepEqual({ ...state, updatedAt: "dynamic" }, { ...expected, updatedAt: "dynamic" });
  assert.match(state.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const persisted = JSON.parse(await readFile(governanceFile, "utf-8"));
  assert.deepEqual({ ...persisted, updatedAt: "dynamic" }, { ...expected, updatedAt: "dynamic" });
});

test("loadGovernanceState preserves valid persisted values after schema validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-governance-"));
  const governanceFile = join(root, "resource-governance.json");

  await writeFile(
    governanceFile,
    JSON.stringify({
      config: {
        thresholds: {
          minUsageToKeep: 4
        },
        toolExecution: {
          retryEnabled: false
        }
      },
      usage: {
        skills: {
          apex: 3
        }
      },
      disabled: {
        tools: ["old_tool"]
      },
      updatedAt: "2026-04-23T00:00:00.000Z"
    }),
    "utf-8"
  );

  const state = await loadGovernanceState(
    governanceFile,
    async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    ["apply_resource_actions"]
  );

  assert.equal(state.config.thresholds.minUsageToKeep, 4);
  assert.equal(state.config.toolExecution.retryEnabled, false);
  assert.equal(state.usage.skills.apex, 3);
  assert.deepEqual(state.disabled.tools, ["old_tool"]);
});

test("tool-error helpers normalize messages and retryability consistently", () => {
  const codedError = new Error("Timeout while calling upstream") as Error & { code?: string };
  codedError.code = "ETIMEDOUT";

  assert.equal(toErrorMessage(codedError), "error: timeout while calling upstream");
  assert.equal(formatErrorMessage(codedError), "Error: Timeout while calling upstream");
  assert.equal(readErrorCode(codedError), "ETIMEDOUT");
  assert.equal(isRetryableError(codedError, ["timeout", "503"]), true);
  assert.equal(isRetryableByCode(codedError, ["503", "ETIMEDOUT"]), true);
});

test("simulateGovernanceChange returns config delta and impacted resources without mutating state", () => {
  const state = buildDefaultGovernanceState(["apply_resource_actions"]);
  state.config.maxCounts.tools = 3;
  state.config.thresholds.minUsageToKeep = 1;
  state.config.thresholds.bugSignalToFlag = 2;

  state.usage.tools = {
    alpha_tool: 5,
    beta_tool: 0,
    gamma_tool: 0,
    delta_tool: 2,
    epsilon_tool: 4
  };
  state.bugSignals.tools = {
    alpha_tool: 0,
    beta_tool: 1,
    gamma_tool: 3,
    delta_tool: 0,
    epsilon_tool: 0
  };

  const beforeState = JSON.stringify(state);

  const simulated = simulateGovernanceChange({
    state,
    catalogs: {
      skills: [],
      tools: ["alpha_tool", "beta_tool", "gamma_tool", "delta_tool", "epsilon_tool"],
      presets: []
    },
    counts: {
      skills: 0,
      tools: 5,
      presets: 0
    },
    resourceScore: (usage, bugs) => usage - bugs * 3,
    patch: {
      updateMaxCounts: { tools: 2 },
      updateThresholds: { minUsageToKeep: 2, bugSignalToFlag: 1 }
    }
  });

  assert.equal(simulated.current.maxCounts.tools, 3);
  assert.equal(simulated.proposed.maxCounts.tools, 2);
  assert.equal(simulated.deltas.maxCounts.tools.diff, -1);
  assert.equal(simulated.deltas.thresholds.minUsageToKeep.diff, 1);
  assert.equal(simulated.impact.recommendationDelta.added > 0, true);
  assert.equal(simulated.impact.byResourceType.tools.projectedOverflow, 3);
  assert.equal(simulated.impact.impactedResources.length > 0, true);

  const impactedToolNames = simulated.impact.impactedResources
    .filter((item) => item.resourceType === "tools")
    .map((item) => item.name);
  assert.ok(impactedToolNames.includes("beta_tool") || impactedToolNames.includes("delta_tool"));

  assert.equal(JSON.stringify(state), beforeState);
});
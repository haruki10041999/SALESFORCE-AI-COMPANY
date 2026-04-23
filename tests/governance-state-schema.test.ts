import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDefaultGovernanceState,
  loadGovernanceState
} from "../mcp/core/governance/governance-state.js";
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
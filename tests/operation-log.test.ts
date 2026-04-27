import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createOperationLog } from "../mcp/core/governance/operation-log.js";

test("operation log appends and loads entries in order", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-oplog-test-"));
  const logFile = join(root, "outputs", "audit", "resource-operations.jsonl");

  try {
    const store = createOperationLog({
      logFile,
      ensureDir: async (dir) => {
        await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
      }
    });

    await store.appendOperationLog({
      type: "create",
      resourceType: "skills",
      name: "sample-skill",
      timestamp: "2026-04-27T00:00:00.000Z"
    });
    await store.appendOperationLog({
      type: "disable",
      resourceType: "tools",
      name: "sample-tool",
      timestamp: "2026-04-27T00:00:01.000Z"
    });

    const items = await store.loadRecentOperations();
    assert.equal(items.length, 2);
    assert.equal(items[0]?.name, "sample-skill");
    assert.equal(items[1]?.name, "sample-tool");
    assert.equal(dirname(logFile).endsWith(join("outputs", "audit")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
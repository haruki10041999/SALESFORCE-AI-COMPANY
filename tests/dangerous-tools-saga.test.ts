import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GovTool, GovToolHandler } from "../mcp/tool-types.js";
import { defineClearMemoryTool } from "../mcp/handlers/memory/clear-memory.js";
import { defineRemoveOrgTool } from "../mcp/handlers/org-catalog/remove-org.js";
import { defineDeployOrgTool } from "../mcp/handlers/core-deployment/deploy-org.js";
import type { RegisterMemoryToolsDeps } from "../mcp/handlers/register-memory-tools.js";

function captureHandler<TInput>(register: (govTool: GovTool) => void): GovToolHandler<TInput> {
  let captured: GovToolHandler<TInput> | undefined;
  const govTool: GovTool = (_name, _config, handler) => {
    captured = handler as unknown as GovToolHandler<TInput>;
  };
  register(govTool);
  assert.ok(captured, "tool handler should be captured");
  return captured;
}

test("clear_memory returns saga metadata and clears all memory", async () => {
  const memory: string[] = ["alpha", "beta"];
  const deps = {
    govTool: undefined as unknown as GovTool,
    addMemory: async (text: string) => {
      memory.push(text);
    },
    searchMemory: async () => [],
    listMemory: async () => [...memory],
    clearMemory: async () => {
      memory.length = 0;
    },
    recordFailureMemory: async () => ({
      pattern: "",
      reason: "",
      preventiveAction: "",
      tags: [],
      recordedAt: new Date().toISOString()
    }),
    searchFailureMemory: async () => [],
    listFailureMemory: async () => []
  } as RegisterMemoryToolsDeps;

  const handler = captureHandler<{}>((govTool) => {
    deps.govTool = govTool;
    defineClearMemoryTool(deps);
  });

  const result = await handler({});
  assert.equal(result.content[0]?.text, "Memory cleared.");
  const payload = JSON.parse(result.content[1]?.text ?? "{}") as {
    saga?: { status?: string };
    snapshotItems?: number;
    restoredItems?: number;
  };

  assert.equal(payload.saga?.status, "completed");
  assert.equal(payload.snapshotItems, 2);
  assert.equal(payload.restoredItems, 0);
  assert.equal(memory.length, 0);
});

test("remove_org returns saga metadata and updates catalog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-ai-remove-org-"));
  const catalogPath = join(dir, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        orgs: [
          {
            alias: "target-org",
            instanceUrl: "https://example.my.salesforce.com",
            type: "sandbox",
            registeredAt: new Date().toISOString()
          }
        ]
      },
      null,
      2
    ),
    "utf-8"
  );

  const handler = captureHandler<{ alias: string }>((govTool) => {
    defineRemoveOrgTool(govTool, catalogPath);
  });

  const result = await handler({ alias: "target-org" });
  const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
    removed?: boolean;
    saga?: { status?: string };
  };

  assert.equal(payload.removed, true);
  assert.equal(payload.saga?.status, "completed");

  const persisted = JSON.parse(readFileSync(catalogPath, "utf-8")) as { orgs?: unknown[] };
  assert.equal(persisted.orgs?.length, 0);
});

test("deploy_org returns saga metadata with generated command", async () => {
  const handler = captureHandler<{
    targetOrg: string;
    dryRun?: boolean;
  }>((govTool) => {
    defineDeployOrgTool({ govTool });
  });

  const result = await handler({ targetOrg: "dev-org", dryRun: true });
  const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
    command?: string;
    dryRun?: boolean;
    saga?: { status?: string };
  };

  assert.equal(payload.saga?.status, "completed");
  assert.equal(payload.dryRun, true);
  assert.ok((payload.command ?? "").includes("--target-org dev-org"));
  assert.ok((payload.command ?? "").includes("--check-only"));
});

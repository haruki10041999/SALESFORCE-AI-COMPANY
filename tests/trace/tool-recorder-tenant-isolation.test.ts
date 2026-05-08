import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolExecutionRecorder } from "../../mcp/core/trace/tool-recorder.js";
import { runWithTenantContext } from "../../mcp/core/identity/tenant-context.js";

test("ToolExecutionRecorder replay is isolated by tenant", async () => {
  const outputsDir = await mkdtemp(join(tmpdir(), "sfai-recorder-tenant-"));

  try {
    await runWithTenantContext("tenant-a", async () => {
      const recorder = new ToolExecutionRecorder({ outputsDir, mode: "record" });
      const result = await recorder.execute({
        toolName: "tenant_demo_tool",
        input: { message: "hello" },
        handler: async () => ({ ok: true })
      });
      assert.equal(result.replayed, false);
    });

    await runWithTenantContext("tenant-b", async () => {
      const replay = new ToolExecutionRecorder({ outputsDir, mode: "replay" });
      await assert.rejects(
        () => replay.execute({
          toolName: "tenant_demo_tool",
          input: { message: "hello" },
          handler: async () => ({ ok: false })
        }),
        /replay miss/
      );
    });

    await runWithTenantContext("tenant-a", async () => {
      const replay = new ToolExecutionRecorder({ outputsDir, mode: "replay" });
      const result = await replay.execute({
        toolName: "tenant_demo_tool",
        input: { message: "hello" },
        handler: async () => ({ ok: false })
      });
      assert.equal(result.replayed, true);
      assert.deepEqual(result.result, { ok: true });
    });
  } finally {
    await rm(outputsDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutionRecorder } from "../../mcp/core/trace/tool-recorder.js";

test("tool recorder records then replays without re-executing handler", async () => {
  const outputsDir = await mkdtemp(join(tmpdir(), "sfai-recorder-"));
  let callCount = 0;

  try {
    const recorder = new ToolExecutionRecorder({ outputsDir, mode: "record" });
    const recorded = await recorder.execute({
      toolName: "demo_tool",
      sessionId: "sess-42",
      input: { message: "hello" },
      handler: async () => {
        callCount += 1;
        return { ok: true, value: 42 };
      }
    });

    assert.equal(recorded.replayed, false);
    assert.equal(callCount, 1);
    assert.deepEqual(recorded.result, { ok: true, value: 42 });

    const replayRecorder = new ToolExecutionRecorder({ outputsDir, mode: "replay" });
    const replayed = await replayRecorder.execute({
      toolName: "demo_tool",
      sessionId: "sess-42",
      input: { message: "hello" },
      handler: async () => {
        callCount += 1;
        return { ok: false };
      }
    });

    assert.equal(replayed.replayed, true);
    assert.equal(callCount, 1);
    assert.deepEqual(replayed.result, { ok: true, value: 42 });
  } finally {
    await rm(outputsDir, { recursive: true, force: true });
  }
});

test("tool recorder stores failures and replays the recorded error", async () => {
  const outputsDir = await mkdtemp(join(tmpdir(), "sfai-recorder-"));
  try {
    const recorder = new ToolExecutionRecorder({ outputsDir, mode: "record" });
    await assert.rejects(
      () => recorder.execute({
        toolName: "failing_tool",
        input: { requestId: "abc" },
        handler: async () => {
          throw new Error("boom");
        }
      }),
      /boom/
    );

    const replayRecorder = new ToolExecutionRecorder({ outputsDir, mode: "replay" });
    await assert.rejects(
      () => replayRecorder.execute({
        toolName: "failing_tool",
        input: { requestId: "abc" },
        handler: async () => ({ ok: true })
      }),
      /boom/
    );
  } finally {
    await rm(outputsDir, { recursive: true, force: true });
  }
});
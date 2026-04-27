import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGovernedToolRegistrar } from "../mcp/core/governance/governed-tool-registrar.js";

type ToolHandler = (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

function makeTempPaths(): { outputsDir: string; serverRoot: string; cleanup: () => void } {
  const serverRoot = mkdtempSync(join(tmpdir(), "sf-ai-gov-registrar-"));
  const outputsDir = join(serverRoot, "outputs");
  return {
    outputsDir,
    serverRoot,
    cleanup: () => rmSync(serverRoot, { recursive: true, force: true })
  };
}

test("governed tool registrar retries retryable failures with backoff", async () => {
  const handlers = new Map<string, ToolHandler>();
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let failuresRecorded = 0;
  let attempts = 0;
  const paths = makeTempPaths();

  const { govTool } = createGovernedToolRegistrar({
    registerTool: (name, _config, handler) => {
      handlers.set(name, handler as ToolHandler);
    },
    isToolDisabled: () => false,
    normalizeResourceName: (name) => name,
    outputsDir: paths.outputsDir,
    serverRoot: paths.serverRoot,
    emitSystemEvent: async (event, payload) => {
      events.push({ event, payload });
    },
    summarizeValue: (value) => (value instanceof Error ? value.message : String(value)),
    registerToolFailure: async () => {
      failuresRecorded += 1;
    },
    getRetryConfig: async () => ({
      retryEnabled: true,
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 20,
      retryablePatterns: ["timeout"],
      retryableCodes: ["ETIMEDOUT"]
    })
  });

  govTool("sample", {}, async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("timeout while calling upstream");
    }
    return {
      content: [{ type: "text", text: "ok" }]
    };
  });

  const handler = handlers.get("sample");
  assert.ok(handler);

  const result = await handler!({});
  assert.equal(result.content[0].text, "ok");
  assert.equal(attempts, 3);
  assert.equal(failuresRecorded, 0);

  const retryEvents = events.filter((e) => e.event === "tool_after_execute" && e.payload.retryScheduled === true);
  assert.equal(retryEvents.length, 2);
  const successEvent = [...events].reverse().find((e) => e.event === "tool_after_execute" && e.payload.success === true);
  assert.ok(successEvent);
  assert.equal(successEvent?.payload.attempts, 3);
  paths.cleanup();
});

test("governed tool registrar does not retry non-retryable failures", async () => {
  const handlers = new Map<string, ToolHandler>();
  let failuresRecorded = 0;
  let attempts = 0;
  const paths = makeTempPaths();

  const { govTool } = createGovernedToolRegistrar({
    registerTool: (name, _config, handler) => {
      handlers.set(name, handler as ToolHandler);
    },
    isToolDisabled: () => false,
    normalizeResourceName: (name) => name,
    outputsDir: paths.outputsDir,
    serverRoot: paths.serverRoot,
    emitSystemEvent: async () => {},
    summarizeValue: (value) => (value instanceof Error ? value.message : String(value)),
    registerToolFailure: async () => {
      failuresRecorded += 1;
    },
    getRetryConfig: async () => ({
      retryEnabled: true,
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 20,
      retryablePatterns: ["timeout"],
      retryableCodes: ["ETIMEDOUT"]
    })
  });

  govTool("sample", {}, async () => {
    attempts += 1;
    throw new Error("validation failed");
  });

  const handler = handlers.get("sample");
  assert.ok(handler);

  await assert.rejects(async () => {
    await handler!({});
  });

  assert.equal(attempts, 1);
  assert.equal(failuresRecorded, 1);
  paths.cleanup();
});

test("governed tool registrar retries when error code matches", async () => {
  const handlers = new Map<string, ToolHandler>();
  let attempts = 0;
  const paths = makeTempPaths();

  const { govTool } = createGovernedToolRegistrar({
    registerTool: (name, _config, handler) => {
      handlers.set(name, handler as ToolHandler);
    },
    isToolDisabled: () => false,
    normalizeResourceName: (name) => name,
    outputsDir: paths.outputsDir,
    serverRoot: paths.serverRoot,
    emitSystemEvent: async () => {},
    summarizeValue: (value) => (value instanceof Error ? value.message : String(value)),
    registerToolFailure: async () => {},
    getRetryConfig: async () => ({
      retryEnabled: true,
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 20,
      retryablePatterns: ["timeout"],
      retryableCodes: ["ETIMEDOUT"]
    })
  });

  govTool("sample", {}, async () => {
    attempts += 1;
    if (attempts < 2) {
      const error = new Error("upstream temporary issue") as Error & { code?: string };
      error.code = "ETIMEDOUT";
      throw error;
    }
    return {
      content: [{ type: "text", text: "ok" }]
    };
  });

  const handler = handlers.get("sample");
  assert.ok(handler);
  const result = await handler!({});
  assert.equal(result.content[0].text, "ok");
  assert.equal(attempts, 2);
  paths.cleanup();
});

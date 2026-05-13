import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createGovernedToolRegistrar } from "../mcp/core/governance/governed-tool-registrar.js";
import { createBanditState } from "../mcp/core/learning/rl-feedback.js";
import type { ToolRateLimiter } from "../mcp/core/reliability/rate-limiter.js";
import type { ToolDefinition } from "../mcp/core/registry/define-tool.js";

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
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");

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
    getBanditState: () => banditState,
    banditStateFile,
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
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");

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
    getBanditState: () => banditState,
    banditStateFile,
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
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");

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
    getBanditState: () => banditState,
    banditStateFile,
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

test("governed tool registrar blocks execution when rate limit is exceeded", async () => {
  const handlers = new Map<string, ToolHandler>();
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const paths = makeTempPaths();
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");

  const rateLimiter: ToolRateLimiter = {
    check: () => ({
      allowed: false,
      scope: "actor",
      key: "user:test",
      limit: 1,
      remaining: 0,
      retryAfterMs: 500
    })
  };

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
    registerToolFailure: async () => {},
    getBanditState: () => banditState,
    banditStateFile,
    rateLimiter,
    getRetryConfig: async () => ({
      retryEnabled: true,
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 20,
      retryablePatterns: ["timeout"],
      retryableCodes: ["ETIMEDOUT"]
    })
  });

  let executed = false;
  govTool("sample", {}, async () => {
    executed = true;
    return {
      content: [{ type: "text", text: "ok" }]
    };
  });

  const handler = handlers.get("sample");
  assert.ok(handler);

  const result = await handler!({});
  assert.equal(executed, false);
  const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
  assert.equal(body.code, "rate_limited");
  assert.equal(body.httpStatus, 429);
  assert.equal(body.scope, "actor");

  const blockedEvent = events.find((e) => e.event === "tool_after_execute" && e.payload.blockedByRateLimit === true);
  assert.ok(blockedEvent);
  paths.cleanup();
});

test("governed tool registrar records cost ledger entries on success", async () => {
  const handlers = new Map<string, ToolHandler>();
  const recorded: Array<Record<string, unknown>> = [];
  const paths = makeTempPaths();
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");
  const previousEnforcerFlag = process.env.SF_AI_COST_BUDGET_ENFORCER_ENABLED;
  process.env.SF_AI_COST_BUDGET_ENFORCER_ENABLED = "true";

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
    costLedger: {
      async record(input) {
        recorded.push(input as Record<string, unknown>);
      }
    },
    getBanditState: () => banditState,
    banditStateFile,
    getRetryConfig: async () => ({
      retryEnabled: false,
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryablePatterns: [],
      retryableCodes: []
    })
  });

  govTool("sample", {}, async () => ({
    content: [{ type: "text", text: "ok" }]
  }));

  const handler = handlers.get("sample");
  assert.ok(handler);

  const result = await handler!({});
  assert.equal(result.content[0].text, "ok");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.toolName, "sample");
  assert.equal(recorded[0]?.status, "success");

  if (previousEnforcerFlag === undefined) {
    delete process.env.SF_AI_COST_BUDGET_ENFORCER_ENABLED;
  } else {
    process.env.SF_AI_COST_BUDGET_ENFORCER_ENABLED = previousEnforcerFlag;
  }
  paths.cleanup();
});

test("P0-4: govTool wraps dict-of-Zod inputSchema into inputSchemaZod for descriptor generation", async () => {
  const capturedDefinitions: ToolDefinition[] = [];
  const paths = makeTempPaths();
  const banditState = createBanditState();
  const banditStateFile = join(paths.outputsDir, "bandit-state.jsonl");

  const { govTool } = createGovernedToolRegistrar({
    registerTool: () => {},
    isToolDisabled: () => false,
    normalizeResourceName: (name) => name,
    outputsDir: paths.outputsDir,
    serverRoot: paths.serverRoot,
    emitSystemEvent: async () => {},
    summarizeValue: (value) => String(value),
    registerToolFailure: async () => {},
    getBanditState: () => banditState,
    banditStateFile,
    onToolDefined: (def) => capturedDefinitions.push(def),
    getRetryConfig: async () => ({
      retryEnabled: false,
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryablePatterns: [],
      retryableCodes: []
    })
  });

  govTool(
    "dict_zod_tool",
    {
      title: "Test Tool",
      description: "test",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().optional()
      }
    },
    async () => ({ content: [{ type: "text", text: "ok" }] })
  );

  assert.equal(capturedDefinitions.length, 1);
  const def = capturedDefinitions[0];
  assert.equal(def.name, "dict_zod_tool");

  // dict-of-Zod は自動で inputSchemaZod に昇格される
  assert.ok(def.inputSchemaZod, "inputSchemaZod should be set from dict-of-Zod");

  // zodToJsonSchema で JSON Schema 変換できる
  const jsonSchema = zodToJsonSchema(def.inputSchemaZod!, { name: "TestSchema" }) as Record<string, unknown>;
  const definitions = (jsonSchema.definitions ?? jsonSchema.$defs) as Record<string, { properties?: Record<string, unknown> }> | undefined;
  const schemaBody = definitions?.["TestSchema"] ?? jsonSchema;
  assert.ok((schemaBody as { properties?: unknown }).properties, "JSON Schema should have properties");
  const props = (schemaBody as { properties: Record<string, unknown> }).properties;
  assert.ok("query" in props, "query field should appear in JSON Schema");
  assert.ok("limit" in props, "limit field should appear in JSON Schema");

  paths.cleanup();
});

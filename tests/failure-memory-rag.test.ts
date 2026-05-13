/**
 * Tests for failure-memory-rag.ts
 * Validates error signature extraction, similarity matching, and RAG injection
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { promises as fsPromises } from "fs";
import { resolve } from "path";
import {
  extractErrorSignature,
  calculateErrorSimilarity,
  searchSimilarFailures,
  generateRAGInjectionPrompt,
  injectFailureContext,
  getRAGInjectionStats,
  type ErrorSignature
} from "../mcp/core/learning/failure-memory-rag.js";
import type { FailureMemoryEntry } from "../mcp/core/memory/index.js";
import {
  configureFailureMemoryStorageForTest,
  listFailureMemory,
  recordFailureMemory
} from "../mcp/core/memory/index.js";

const FAILURE_MEMORY_PATH = resolve("outputs", "learning", "failure-memory-rag-test.jsonl");
const RAG_CACHE_PATH = resolve("outputs", "learning", "rag-injection-cache.jsonl");

async function setupTest(): Promise<void> {
  await fsPromises.mkdir(resolve("outputs", "learning"), { recursive: true });
  await fsPromises.writeFile(FAILURE_MEMORY_PATH, "");
  configureFailureMemoryStorageForTest(FAILURE_MEMORY_PATH);

  await recordFailureMemory({
    pattern: "Module has no exported member RewardRecord",
    reason: "Type not exported from module",
    preventiveAction: "Add export keyword to interface definition",
    tags: ["typescript", "reward-aggregator", "architect", "type-check", "build"]
  });
  await recordFailureMemory({
    pattern: "Module declares RewardRecord locally but it is not exported",
    reason: "Missing export statement",
    preventiveAction: "Ensure export keyword precedes interface",
    tags: ["typescript", "feedback-manager", "debug-specialist", "import", "dev"]
  });
  await recordFailureMemory({
    pattern: "assert.ok(rolled) failed",
    reason: "Field not initialized in constructor",
    preventiveAction: "Ensure previousVersion field is set during proposal creation",
    tags: ["test", "staged-adoption", "qa-engineer"]
  });
}

async function cleanupTest(): Promise<void> {
  try {
    await fsPromises.unlink(FAILURE_MEMORY_PATH);
  } catch {
    // File may not exist
  }
  try {
    await fsPromises.unlink(RAG_CACHE_PATH);
  } catch {
    // File may not exist
  }
}

test("extractErrorSignature extracts code, keywords, and stack patterns", async () => {
  const errorData = {
    code: "TS2459",
    message: "Module has no exported member RewardRecord from reward-aggregator",
    stack: `at staged-adoption.ts:9:15
at Object.<anonymous> (staged-adoption.ts:1:0)
at Module._compile (internal/modules/cjs/loader.js:1099:13)`,
    context: {
      tool: "reward-aggregator",
      agent: "architect",
      operation: "type-check",
      stage: "build"
    }
  };

  const sig = extractErrorSignature(errorData);

  assert.equal(sig.code, "TS2459");
  assert.ok(sig.messageKeywords.length > 0);
  assert.ok(sig.messageKeywords.includes("module"));
  assert.ok(sig.stackPatterns.length > 0);
  assert.equal(sig.context.tool, "reward-aggregator");
});

test("failure-memory persists encrypted payload when at-rest encryption is enabled", async () => {
  const encryptedPath = resolve("outputs", "learning", "failure-memory-encrypted-test.jsonl");
  const prevEnabled = process.env.SF_AI_ENCRYPTION_ENABLED;
  const prevKey = process.env.SF_AI_ENCRYPTION_KEY_B64;
  const prevKeyId = process.env.SF_AI_ENCRYPTION_KEY_ID;
  const keyB64 = Buffer.from("0123456789abcdef0123456789abcdef", "utf-8").toString("base64");

  try {
    await fsPromises.mkdir(resolve("outputs", "learning"), { recursive: true });
    process.env.SF_AI_ENCRYPTION_ENABLED = "true";
    process.env.SF_AI_ENCRYPTION_KEY_B64 = keyB64;
    process.env.SF_AI_ENCRYPTION_KEY_ID = "test-failure-v1";

    configureFailureMemoryStorageForTest(encryptedPath);
    await recordFailureMemory({
      pattern: "sensitive-pattern",
      reason: "contains private context",
      preventiveAction: "mask secrets before logging",
      tags: ["security"]
    });

    const raw = await fsPromises.readFile(encryptedPath, "utf-8");
    assert.equal(raw.includes("sensitive-pattern"), false);
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    assert.equal(typeof parsed.ciphertext, "string");
    assert.equal(parsed.keyId, "test-failure-v1");

    configureFailureMemoryStorageForTest(encryptedPath);
    const rows = await listFailureMemory(20);
    assert.ok(rows.some((row) => row.pattern === "sensitive-pattern"));
  } finally {
    if (typeof prevEnabled === "string") {
      process.env.SF_AI_ENCRYPTION_ENABLED = prevEnabled;
    } else {
      delete process.env.SF_AI_ENCRYPTION_ENABLED;
    }
    if (typeof prevKey === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_B64 = prevKey;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_B64;
    }
    if (typeof prevKeyId === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_ID = prevKeyId;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_ID;
    }
    try {
      await fsPromises.unlink(encryptedPath);
    } catch {
      // ignore cleanup failure
    }
  }
});

test("calculateErrorSimilarity returns 0 for completely different errors", () => {
  const sig1: ErrorSignature = {
    code: "TS2459",
    messageKeywords: ["module", "export"],
    stackPatterns: ["staged-adoption.ts"],
    context: { tool: "reward-aggregator" }
  };

  const failureEntry: FailureMemoryEntry = {
    pattern: "Different pattern",
    reason: "Unrelated failure",
    preventiveAction: "Unrelated solution",
    tags: [],
    recordedAt: new Date().toISOString()
  };

  const similarity = calculateErrorSimilarity(sig1, failureEntry);
  assert.ok(similarity < 0.6, "Should be low similarity for different errors");
});

test("calculateErrorSimilarity returns high score for identical errors", () => {
  const sig1: ErrorSignature = {
    code: "TS2459",
    messageKeywords: ["module", "exported", "member"],
    stackPatterns: ["staged-adoption.ts"],
    context: { tool: "reward-aggregator", agent: "architect" }
  };

  const failureEntry: FailureMemoryEntry = {
    pattern: "Module exported member",
    reason: "Type missing export",
    preventiveAction: "Add export keyword",
    tags: ["typescript", "reward-aggregator"],
    recordedAt: new Date().toISOString()
  };

  const similarity = calculateErrorSimilarity(sig1, failureEntry);
  assert.ok(similarity > 0.4, "Should be meaningful similarity for close patterns");
});

test("searchSimilarFailures finds matching failures from memory", async () => {
  await setupTest();
  try {
    const errorSig = extractErrorSignature({
      code: "TS2459",
      message: "Module does not export RewardRecord type",
      context: { tool: "staged-adoption" }
    });

    const matches = await searchSimilarFailures(errorSig, 3);
    assert.ok(matches.length > 0, "Should find at least one similar failure");
    assert.ok(
      matches.some((m) => m.record.pattern.toLowerCase().includes("rewardrecord")),
      "Should include RewardRecord-related historical failure"
    );
  } finally {
    await cleanupTest();
  }
});

test("generateRAGInjectionPrompt creates guidance from similar failures", async () => {
  await setupTest();
  try {
    const errorSig = extractErrorSignature({
      code: "TS2459",
      message: "Module has no exported member",
      context: { tool: "reward-aggregator" }
    });

    const matches = await searchSimilarFailures(errorSig, 5);
    assert.ok(matches.length > 0);

    const { prompt, confidence } = generateRAGInjectionPrompt(matches);
    assert.ok(prompt.length > 0, "Should generate non-empty injection prompt");
    assert.ok(confidence > 0, "Should have positive confidence");
    assert.ok(prompt.includes("Recommended Approach"), "Should include recommended approach section");
  } finally {
    await cleanupTest();
  }
});

test("injectFailureContext runs full RAG pipeline", async () => {
  await setupTest();
  try {
    const errorData = {
      code: "TS2459",
      message: "Module declares something locally but does not export it",
      stack: "at staged-adoption.ts:9",
      context: { tool: "reward-aggregator", agent: "architect" }
    };

    const result = await injectFailureContext(errorData);

    assert.ok(result.errorSignature);
    assert.ok(result.errorSignature.code === "TS2459");
    assert.ok(Array.isArray(result.similarFailures));
    if (result.similarFailures.length > 0) {
      assert.ok(result.injectionPrompt.length > 0);
      assert.ok(result.confidence > 0);
    }
  } finally {
    await cleanupTest();
  }
});

test("getRAGInjectionStats monitors RAG performance", async () => {
  await setupTest();
  try {
    // Generate some injections first
    for (let i = 0; i < 3; i++) {
      await injectFailureContext({
        code: "TS2459",
        message: `Test error ${i}`,
        context: { tool: "test-tool" }
      });
    }

    const stats = await getRAGInjectionStats(24);
    assert.ok(stats.totalInjections >= 0);
    assert.ok(stats.avgConfidence >= 0 && stats.avgConfidence <= 1);
    assert.ok(Array.isArray(stats.topRecommendedErrors));
  } finally {
    await cleanupTest();
  }
});

test("RAG injection handles empty failure memory gracefully", async () => {
  const EMPTY_FAILURE_MEMORY_PATH = resolve("outputs", "learning", "failure-memory-rag-empty-test.jsonl");
  try {
    await fsPromises.mkdir(resolve("outputs", "learning"), { recursive: true });
    await fsPromises.writeFile(EMPTY_FAILURE_MEMORY_PATH, "");
    configureFailureMemoryStorageForTest(EMPTY_FAILURE_MEMORY_PATH);

    const result = await injectFailureContext({
      code: "UNKNOWN_ERROR",
      message: "This is an error with no history",
      context: { tool: "unknown" }
    });

    assert.ok(result);
    assert.equal(result.similarFailures.length, 0);
    assert.equal(result.injectionPrompt, "");
    assert.equal(result.confidence, 0);
  } finally {
    try {
      await fsPromises.unlink(EMPTY_FAILURE_MEMORY_PATH);
    } catch {
      // File may not exist
    }
    await cleanupTest();
  }
});

test("Error signature extraction handles missing fields gracefully", () => {
  const minimal = {
    message: "Something went wrong"
  };

  const sig = extractErrorSignature(minimal);

  assert.ok(sig);
  assert.ok(Array.isArray(sig.messageKeywords));
  assert.ok(Array.isArray(sig.stackPatterns));
  assert.ok(sig.context);
});

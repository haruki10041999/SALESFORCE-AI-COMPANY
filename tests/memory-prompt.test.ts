import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  addMemory,
  clearMemory,
  configureMemoryLimitsForTest,
  configureMemoryStorageForTest,
  listMemory,
  searchMemory
} from "../memory/project-memory.js";
import {
  addRecord,
  clearRecords,
  configureVectorStoreLimitsForTest,
  configureVectorStoreForTest,
  searchByKeyword
} from "../memory/vector-store.js";
import { buildPrompt } from "../prompt-engine/prompt-builder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

test("project-memory supports add, search, and list copy semantics", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-memory-copy-test-"));
  const tempStorage = join(tempRoot, "memory.jsonl");
  const token = `memory-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const searchable = `Release checklist ${token}`;

  try {
    configureMemoryStorageForTest(tempStorage);
    clearMemory();
    addMemory(searchable);
    addMemory(`Security note ${token}`);

    const found = searchMemory(token.toUpperCase());
    assert.ok(found.some((v) => v === searchable));

    const snapshot = listMemory();
    const injected = `injected-${token}`;
    snapshot.push(injected);

    const after = listMemory();
    assert.equal(after.includes(injected), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("project-memory persists to disk and can be reloaded", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-memory-test-"));
  const tempStorage = join(tempRoot, "memory.jsonl");
  const token = `persistent-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    configureMemoryStorageForTest(tempStorage);
    clearMemory();
    addMemory(`Persist ${token}`);

    configureMemoryStorageForTest(tempStorage);
    const items = listMemory();
    assert.ok(items.some((item) => item.includes(token)));
  } finally {
    configureMemoryStorageForTest(join(ROOT, "outputs", "memory.jsonl"));
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("project-memory applies retention limit", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-memory-retention-test-"));
  const tempStorage = join(tempRoot, "memory.jsonl");

  try {
    configureMemoryStorageForTest(tempStorage);
    configureMemoryLimitsForTest({ maxRecords: 10, maxBytes: 1000000 });
    clearMemory();

    for (let i = 0; i < 15; i += 1) {
      addMemory(`memory-${i}`);
    }

    const items = listMemory();
    assert.equal(items.length, 10);
    assert.equal(items[0], "memory-5");
  } finally {
    configureMemoryLimitsForTest({ maxRecords: 2000, maxBytes: 1024 * 1024 });
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("vector-store searchByKeyword matches both text and tags case-insensitively", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-vector-search-test-"));
  const tempStorage = join(tempRoot, "vector-store.jsonl");

  configureVectorStoreForTest(tempStorage);
  clearRecords();

  try {
    const id = `record-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addRecord({
      id,
      text: "Order validation guard for bulk update",
      tags: ["Salesforce", "Bulk"]
    });

    const byText = searchByKeyword("validation guard");
    assert.ok(byText.some((r) => r.id === id));

    const byTag = searchByKeyword("bulk");
    assert.ok(byTag.some((r) => r.id === id));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("vector-store persists to disk and can be reloaded", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-vector-test-"));
  const tempStorage = join(tempRoot, "vector-store.jsonl");
  const id = `vector-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    configureVectorStoreForTest(tempStorage);
    clearRecords();
    addRecord({
      id,
      text: "Persistent vector note for orchestration recovery",
      tags: ["orchestration", "recovery"]
    });

    configureVectorStoreForTest(tempStorage);
    const results = searchByKeyword("recovery");
    assert.ok(results.some((record) => record.id === id));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("vector-store applies retention limit", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-vector-retention-test-"));
  const tempStorage = join(tempRoot, "vector-store.jsonl");

  try {
    configureVectorStoreForTest(tempStorage);
    configureVectorStoreLimitsForTest({ maxRecords: 10, maxBytes: 1000000 });
    clearRecords();

    for (let i = 0; i < 15; i += 1) {
      addRecord({
        id: `id-${i}`,
        text: `vector text ${i}`,
        tags: ["retention"]
      });
    }

    const results = searchByKeyword("vector");
    assert.ok(results.length <= 10);
    assert.equal(results.some((record) => record.id === "id-0"), false);
  } finally {
    configureVectorStoreLimitsForTest({ maxRecords: 5000, maxBytes: 2 * 1024 * 1024 });
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prompt-builder includes base, agent, task, and reasoning framework", () => {
  const base = readFileSync(join(ROOT, "prompt-engine", "base-prompt.md"), "utf-8");
  const reasoning = readFileSync(join(ROOT, "prompt-engine", "reasoning-framework.md"), "utf-8");

  const prompt = buildPrompt(
    {
      name: "qa-engineer",
      content: "Focus on regression risk and edge cases."
    },
    "Review changed Apex classes and propose tests"
  );

  assert.ok(prompt.includes(base.trim()));
  assert.ok(prompt.includes("Agent\nqa-engineer"));
  assert.ok(prompt.includes("Focus on regression risk and edge cases."));
  assert.ok(prompt.includes("Task\nReview changed Apex classes and propose tests"));
  assert.ok(prompt.includes(reasoning.trim()));
});

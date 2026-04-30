import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateCategoryBudgets,
  DEFAULT_CATEGORY_WEIGHTS,
  loadCategoryWeightsFromFile
} from "../mcp/core/context/context-budget.js";
import { truncateContent } from "../mcp/core/context/markdown-catalog.js";
import { countTokens } from "../mcp/core/prompt/token-counter.js";

test("F6: returns undefined for every category when maxContextChars is unset", () => {
  const b = allocateCategoryBudgets(undefined, {
    agent: 3, skill: 2, code: 1, context: 1, persona: 1, framework: 3
  });
  assert.equal(b.agent, undefined);
  assert.equal(b.framework, undefined);
});

test("F6: agent weight gives higher per-item budget than persona at equal counts", () => {
  const b = allocateCategoryBudgets(10_000, {
    agent: 1, skill: 1, code: 1, context: 1, persona: 1, framework: 1
  });
  assert.ok((b.agent ?? 0) > (b.persona ?? 0), `agent=${b.agent} persona=${b.persona}`);
  assert.ok((b.skill ?? 0) > (b.framework ?? 0), `skill=${b.skill} framework=${b.framework}`);
});

test("F6: zero-count categories receive undefined and re-distribute weight", () => {
  const b = allocateCategoryBudgets(10_000, {
    agent: 1, skill: 0, code: 0, context: 0, persona: 0, framework: 0
  });
  assert.equal(b.skill, undefined);
  assert.equal(b.code, undefined);
  // agent absorbs the entire remaining budget (minus floor losses)
  assert.ok((b.agent ?? 0) >= 9000, `agent should consume residual budget, got ${b.agent}`);
});

test("F6: per-item budget shrinks linearly when item count grows", () => {
  const b1 = allocateCategoryBudgets(6_000, {
    agent: 1, skill: 0, code: 0, context: 0, persona: 0, framework: 0
  });
  const b3 = allocateCategoryBudgets(6_000, {
    agent: 3, skill: 0, code: 0, context: 0, persona: 0, framework: 0
  });
  assert.ok((b1.agent ?? 0) > (b3.agent ?? 0));
  assert.ok((b1.agent ?? 0) >= 3 * (b3.agent ?? 0) - 5, "should be ~3x larger when only 1/3 items");
});

test("F6: weights add up to 1.0", () => {
  const sum = Object.values(DEFAULT_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `weights sum should be 1.0, got ${sum}`);
});

test("F6: loadCategoryWeightsFromFile returns parsed config", () => {
  const root = mkdtempSync(join(tmpdir(), "ctx-budget-"));
  const filePath = join(root, "context-budget.json");
  try {
    writeFileSync(filePath, JSON.stringify({
      agent: 0.4,
      skill: 0.2,
      code: 0.1,
      context: 0.2,
      persona: 0.05,
      framework: 0.05
    }), "utf-8");

    const loaded = loadCategoryWeightsFromFile(filePath);
    assert.equal(loaded?.agent, 0.4);
    assert.equal(loaded?.skill, 0.2);
    assert.equal(loaded?.framework, 0.05);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F6: loadCategoryWeightsFromFile returns undefined for invalid file", () => {
  const root = mkdtempSync(join(tmpdir(), "ctx-budget-invalid-"));
  const filePath = join(root, "context-budget.json");
  try {
    writeFileSync(filePath, JSON.stringify({ agent: -1 }), "utf-8");
    const loaded = loadCategoryWeightsFromFile(filePath);
    assert.equal(loaded, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F6: truncateContent keeps original text when within token budget", () => {
  const text = "short text for token budget";
  const budget = countTokens(text).tokens + 5;
  const out = truncateContent(text, budget, "sample");
  assert.equal(out, text);
});

test("F6: truncateContent enforces token budget", () => {
  const text = Array.from({ length: 300 }, (_, i) => `token-${i}`).join(" ");
  const out = truncateContent(text, 40, "sample");

  const tokenCount = countTokens(out).tokens;
  assert.ok(tokenCount <= 40, `token count should be <= 40, got ${tokenCount}`);
  assert.notEqual(out, text);
});

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  allocateCategoryBudgets,
  DEFAULT_CATEGORY_WEIGHTS
} from "../mcp/core/context/context-budget.js";

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

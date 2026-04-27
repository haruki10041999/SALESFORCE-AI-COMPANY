import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createBanditState,
  recordFeedbacks,
  computeDynamicExplorationRate
} from "../mcp/core/learning/rl-feedback.js";

test("computeDynamicExplorationRate is high for cold arms", () => {
  const state = createBanditState();
  // 全 arm が学習量 2 (Beta(1,1) + 1 sample) しかない → 探索率高め
  recordFeedbacks(state, [
    { name: "a", reward: true },
    { name: "b", reward: false }
  ]);
  const rate = computeDynamicExplorationRate(state);
  assert.ok(rate > 0.2, `expected elevated exploration, got ${rate}`);
});

test("computeDynamicExplorationRate is low for well-explored arms", () => {
  const state = createBanditState();
  for (let i = 0; i < 100; i++) {
    recordFeedbacks(state, [
      { name: "a", reward: i % 2 === 0 },
      { name: "b", reward: i % 3 === 0 }
    ]);
  }
  const rate = computeDynamicExplorationRate(state);
  assert.ok(rate < 0.05, `expected low exploration, got ${rate}`);
});

test("computeDynamicExplorationRate respects maxRate", () => {
  const state = createBanditState();
  const rate = computeDynamicExplorationRate(state, { maxRate: 0.2 });
  assert.ok(rate <= 0.2);
});

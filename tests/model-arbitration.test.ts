import { test } from "node:test";
import { strict as assert } from "node:assert";
import { arbitrate, DEFAULT_ARBITRATION_POLICY } from "../mcp/core/learning/model-arbitration.js";

const baseStats = {
  shadowVersion: "v2",
  productionVersion: "v1",
  productionWins: 30,
  shadowWins: 80,
  ties: 0,
  total: 110,
  signedDelta: 0.45,
  shadowWinRate: 80 / 110
};

test("F4: rejects when coverage is insufficient", () => {
  const decision = arbitrate({
    modelName: "query-skill",
    candidate: { ...baseStats, total: 5 }
  });
  assert.equal(decision.kind, "reject");
  assert.match(decision.reason, /coverage/);
  assert.equal(decision.axes.coverage.pass, false);
});

test("F4: rejects with low-confidence when winRate hovers near 0.5", () => {
  const decision = arbitrate({
    modelName: "query-skill",
    candidate: { ...baseStats, shadowWinRate: 0.51, total: 50 }
  });
  assert.equal(decision.kind, "reject");
  assert.match(decision.reason, /low-confidence/);
});

test("F4: holds when recency advantage is missing under custom policy", () => {
  const decision = arbitrate(
    {
      modelName: "query-skill",
      candidate: baseStats,
      candidateUpdatedAt: 1_000,
      productionUpdatedAt: 5_000
    },
    { ...DEFAULT_ARBITRATION_POLICY, recencyAdvantageMs: 1 }
  );
  assert.equal(decision.kind, "hold");
  assert.match(decision.reason, /recency/);
});

test("F4: promotes when all axes pass", () => {
  const decision = arbitrate({
    modelName: "query-skill",
    candidate: baseStats,
    candidateUpdatedAt: 10_000,
    productionUpdatedAt: 1_000
  });
  assert.equal(decision.kind, "promote");
  assert.equal(decision.axes.coverage.pass, true);
  assert.equal(decision.axes.confidence.pass, true);
  assert.equal(decision.axes.recency.pass, true);
});

test("F4: holds when signedDelta is non-positive", () => {
  const decision = arbitrate({
    modelName: "query-skill",
    candidate: { ...baseStats, signedDelta: 0 }
  });
  assert.equal(decision.kind, "hold");
  assert.match(decision.reason, /signedDelta/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createLinUcbState,
  exportLinUcbFeatureImportance,
  updateLinUcbArm,
  rankLinUcbArms,
  toLinUcbSnapshot,
  fromLinUcbSnapshot
} from "../mcp/core/learning/lin-ucb-bandit.js";

test("LinUCB ranks rewarded arm higher after updates", () => {
  const state = createLinUcbState(2, ["A", "B"]);

  for (let i = 0; i < 20; i += 1) {
    updateLinUcbArm(state, "A", [1, 0], 1.0);
    updateLinUcbArm(state, "B", [1, 0], 0.2);
  }

  const ranked = rankLinUcbArms(
    state,
    [
      { name: "A", features: [1, 0] },
      { name: "B", features: [1, 0] }
    ],
    0.1
  );

  assert.equal(ranked[0]?.name, "A");
  assert.ok((ranked[0]?.score ?? 0) >= (ranked[1]?.score ?? 0));
});

test("LinUCB snapshot round-trip preserves ranking behavior", () => {
  const state = createLinUcbState(2, ["A", "B"]);
  updateLinUcbArm(state, "A", [1, 1], 0.9);
  updateLinUcbArm(state, "B", [1, 1], 0.1);

  const snap = toLinUcbSnapshot(state);
  const restored = fromLinUcbSnapshot(snap);

  const ranked = rankLinUcbArms(
    restored,
    [
      { name: "A", features: [1, 1] },
      { name: "B", features: [1, 1] }
    ],
    0.05
  );

  assert.equal(ranked[0]?.name, "A");
});

test("LinUCB throws on feature dimension mismatch", () => {
  const state = createLinUcbState(3, ["A"]);
  assert.throws(() => updateLinUcbArm(state, "A", [1, 2], 1));
});

test("LinUCB exports feature importance ranked by absolute coefficient", () => {
  const state = createLinUcbState(2, ["A", "B"]);

  for (let i = 0; i < 20; i += 1) {
    updateLinUcbArm(state, "A", [1, 0], 1.0);
    updateLinUcbArm(state, "B", [0, 1], 0.1);
  }

  const importance = exportLinUcbFeatureImportance(state, {
    featureNames: ["fit", "latency"],
    topK: 2
  });

  assert.equal(importance.length, 2);
  assert.equal(importance[0]?.featureName, "fit");
  assert.ok((importance[0]?.importance ?? 0) > (importance[1]?.importance ?? 0));
});

test("LinUCB feature importance with minPulls filters cold arms", () => {
  const state = createLinUcbState(2, ["A", "cold"]);
  for (let i = 0; i < 5; i += 1) {
    updateLinUcbArm(state, "A", [1, 0], 1.0);
  }

  const noData = exportLinUcbFeatureImportance(state, { minPulls: 10 });
  assert.ok(noData.every((row) => row.importance === 0));
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createLinUcbState,
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

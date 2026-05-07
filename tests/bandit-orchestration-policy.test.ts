import test from "node:test";
import assert from "node:assert/strict";

import { createLinUcbState, updateLinUcbArm } from "../mcp/core/learning/lin-ucb-bandit.js";
import { selectAgentWithPolicyMixer } from "../mcp/core/learning/bandit-orchestration-policy.js";

test("selectAgentWithPolicyMixer: forced exploration chooses coldest agent", async () => {
  const state = createLinUcbState(1);
  updateLinUcbArm(state, "hot", [1], 0.9);
  updateLinUcbArm(state, "hot", [1], 0.8);

  const result = await selectAgentWithPolicyMixer({
    candidates: ["hot", "cold"],
    topic: "orchestration",
    banditState: state,
    forcedExplorationRate: 1,
    rng: () => 0
  });

  assert.equal(result.selectedAgent, "cold");
  assert.equal(result.rationale.forcedExplorationApplied, true);
  assert.equal(result.rationale.exploredAgent, "cold");
});

test("selectAgentWithPolicyMixer: no forced exploration keeps policy winner", async () => {
  const state = createLinUcbState(1);
  updateLinUcbArm(state, "hot", [1], 0.9);

  const result = await selectAgentWithPolicyMixer({
    candidates: ["hot", "cold"],
    topic: "orchestration",
    graphRecommendation: {
      agent: "hot",
      probability: 1
    },
    banditState: state,
    forcedExplorationRate: 0,
    rng: () => 0
  });

  assert.equal(result.selectedAgent, "hot");
  assert.equal(result.rationale.forcedExplorationApplied, false);
});

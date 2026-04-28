import test from "node:test";
import assert from "node:assert/strict";

import { runSelfRefineLoop } from "../mcp/core/learning/self-refine-loop.js";
import type { QualityRubricResult } from "../mcp/core/llm/quality-rubric.js";

function makeResult(score: number): QualityRubricResult {
  return {
    overallScore: score,
    method: "heuristic",
    criteria: [
      { id: "relevance", score, rationale: "r" },
      { id: "completeness", score, rationale: "r" },
      { id: "actionability", score, rationale: "r" },
      { id: "safety", score, rationale: "r" },
      { id: "structure", score, rationale: "r" }
    ]
  };
}

test("runSelfRefineLoop: stops when target score reached", async () => {
  const out = await runSelfRefineLoop("draft", { targetScore: 8 }, {
    evaluate: async () => makeResult(8.4),
    refine: async () => "draft"
  });

  assert.equal(out.stoppedReason, "target-reached");
  assert.equal(out.iterations.length, 1);
  assert.equal(out.finalScore, 8.4);
});

test("runSelfRefineLoop: stops on no improvement threshold", async () => {
  const queue = [makeResult(6.5), makeResult(6.6)];
  const out = await runSelfRefineLoop("draft", { maxIterations: 3, minImprovement: 0.2 }, {
    evaluate: async () => queue.shift() ?? makeResult(6.6),
    refine: async () => "revised"
  });

  assert.equal(out.stoppedReason, "no-improvement");
  assert.equal(out.finalText, "revised");
  assert.equal(out.finalScore, 6.6);
});

test("runSelfRefineLoop: reaches max iterations with sustained improvements", async () => {
  const queue = [makeResult(5.5), makeResult(6.1), makeResult(6.4), makeResult(6.8), makeResult(7.1)];
  const out = await runSelfRefineLoop("draft", { maxIterations: 3, minImprovement: 0.1 }, {
    evaluate: async () => queue.shift() ?? makeResult(7.1),
    refine: async ({ iteration }) => `revised-${iteration}`
  });

  assert.equal(out.stoppedReason, "max-iterations");
  assert.equal(out.iterations.length, 3);
  assert.equal(out.finalText, "revised-2");
});

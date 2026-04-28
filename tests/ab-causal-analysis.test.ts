import test from "node:test";
import assert from "node:assert/strict";

import { summarizeAbCausalHistory } from "../mcp/core/learning/ab-causal-analysis.js";

test("summarizeAbCausalHistory computes significance and strata", () => {
  const runs = [
    {
      generatedAt: "2026-04-01T10:00:00.000Z",
      comparison: "architect vs qa-engineer",
      winner: { overall: "architect" },
      runs: {
        agentA: { agent: "architect", qualityScore: 90, durationMs: 1000 },
        agentB: { agent: "qa-engineer", qualityScore: 70, durationMs: 1200 }
      }
    },
    {
      generatedAt: "2026-04-02T10:00:00.000Z",
      comparison: "architect vs qa-engineer",
      winner: { overall: "architect" },
      runs: {
        agentA: { agent: "architect", qualityScore: 91, durationMs: 990 },
        agentB: { agent: "qa-engineer", qualityScore: 71, durationMs: 1210 }
      }
    },
    {
      generatedAt: "2026-05-01T10:00:00.000Z",
      comparison: "architect vs qa-engineer",
      winner: { overall: "architect" },
      runs: {
        agentA: { agent: "architect", qualityScore: 92, durationMs: 980 },
        agentB: { agent: "qa-engineer", qualityScore: 72, durationMs: 1220 }
      }
    },
    {
      generatedAt: "2026-05-02T10:00:00.000Z",
      comparison: "architect vs qa-engineer",
      winner: { overall: "qa-engineer" },
      runs: {
        agentA: { agent: "architect", qualityScore: 89, durationMs: 1010 },
        agentB: { agent: "qa-engineer", qualityScore: 73, durationMs: 1230 }
      }
    }
  ];

  const out = summarizeAbCausalHistory(runs);
  assert.equal(out.totalRuns, 4);
  assert.equal(out.monthlyStrata.length, 2);
  assert.deepEqual(out.monthlyStrata.map((x) => x.month), ["2026-04", "2026-05"]);

  const comp = out.comparisons[0];
  assert.equal(comp.comparison, "architect vs qa-engineer");
  assert.equal(comp.decisiveRuns, 4);
  assert.equal(comp.wins["architect"], 3);
  assert.equal(comp.wins["qa-engineer"], 1);
  assert.ok(typeof comp.pValueTwoSided === "number");
});

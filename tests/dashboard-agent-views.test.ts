import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildAgentTopicHeatmap,
  buildAgentTrustScoreTimeline
} from "../mcp/core/observability/dashboard-agent-views.js";

test("buildAgentTopicHeatmap renders matrix with success rate cells", () => {
  const out = buildAgentTopicHeatmap([
    { agent: "alpha", topic: "apex", count: 10, successRate: 0.9 },
    { agent: "alpha", topic: "lwc", count: 4, successRate: 0.5 },
    { agent: "beta", topic: "apex", count: 2, successRate: 1 }
  ]);
  assert.deepEqual(out.agents, ["alpha", "beta"]);
  assert.deepEqual(out.topics, ["apex", "lwc"]);
  // alpha/apex
  assert.equal(out.matrix[0][0], 0.9);
  // beta/lwc は観測なし
  assert.equal(out.matrix[1][1], null);
  assert.match(out.markdown, /alpha/);
});

test("buildAgentTrustScoreTimeline buckets samples by day", () => {
  const out = buildAgentTrustScoreTimeline(
    [
      { agent: "a", timestamp: "2026-04-01T00:00:00Z", trustScore: 0.7 },
      { agent: "a", timestamp: "2026-04-01T12:00:00Z", trustScore: 0.9 },
      { agent: "a", timestamp: "2026-04-03T00:00:00Z", trustScore: 0.5 },
      { agent: "b", timestamp: "2026-04-02T00:00:00Z", trustScore: 1.0 }
    ]
  );
  assert.deepEqual(out.agents, ["a", "b"]);
  // a: 1 日目は (0.7 + 0.9)/2 = 0.8
  assert.equal(out.series[0][0], 0.8);
});

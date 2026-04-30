import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAgentTransitionModel,
  loadAgentGraphRecords,
  recordAgentSequence,
  recommendNextAgents
} from "../mcp/core/learning/agent-graph-learner.js";

test("agent graph learner records sequence and recommends next agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-agent-graph-"));
  const filePath = join(root, "agent-graph.jsonl");

  try {
    await recordAgentSequence(filePath, {
      sessionId: "s1",
      sequence: ["architect", "qa-engineer", "debug-specialist"],
      success: true,
      recordedAt: "2026-04-30T00:00:00.000Z"
    });
    await recordAgentSequence(filePath, {
      sessionId: "s2",
      sequence: ["architect", "qa-engineer"],
      success: true,
      recordedAt: "2026-04-30T00:01:00.000Z"
    });

    const records = await loadAgentGraphRecords(filePath);
    assert.equal(records.length, 2);

    const model = buildAgentTransitionModel(records);
    const recommendations = recommendNextAgents({
      model,
      fromAgent: "architect",
      candidates: ["qa-engineer", "debug-specialist"],
      limit: 2
    });

    assert.equal(recommendations.length >= 1, true);
    assert.equal(recommendations[0]?.to, "qa-engineer");
    assert.equal(recommendations[0]?.probability > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

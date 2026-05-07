import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateAgentPersonaWeekly,
  type AgentSynergyRecord
} from "../mcp/core/learning/agent-synergy.js";

test("aggregateAgentPersonaWeekly groups by week x agent x persona", () => {
  const records: AgentSynergyRecord[] = [
    {
      recordedAt: "2026-05-01T10:00:00.000Z",
      agents: ["architect", "qa-engineer"],
      persona: "strategist",
      qualityScore: 0.9,
      success: true
    },
    {
      recordedAt: "2026-05-03T12:00:00.000Z",
      agents: ["architect"],
      persona: "strategist",
      qualityScore: 0.4,
      success: false
    }
  ];

  const weekly = aggregateAgentPersonaWeekly(records, {
    now: new Date("2026-05-07T00:00:00.000Z"),
    weeks: 4
  });

  const architect = weekly.find((row) => row.agent === "architect" && row.persona === "strategist");
  assert.ok(architect);
  assert.equal(architect?.sessions, 2);
  assert.equal(architect?.successes, 1);
  assert.equal(architect?.successRate, 0.5);
});

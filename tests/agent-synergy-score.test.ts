import { test } from "node:test";
import { strict as assert } from "node:assert";
import { scoreAgentSynergy, type AgentSynergyChatSession } from "../mcp/tools/agent-synergy-score.js";

function makeSession(agents: string[], entryAgents: string[] = agents): AgentSynergyChatSession {
  return {
    agents,
    entries: entryAgents.map((agent) => ({ agent }))
  };
}

test("A6: empty input returns zero pairs", () => {
  const r = scoreAgentSynergy([]);
  assert.equal(r.totalSessions, 0);
  assert.equal(r.totalAgents, 0);
  assert.equal(r.pairs.length, 0);
});

test("A6: pair occurring together gets a positive score", () => {
  const r = scoreAgentSynergy([
    makeSession(["architect", "apex-developer"]),
    makeSession(["architect", "apex-developer"]),
    makeSession(["architect", "apex-developer"])
  ]);
  assert.equal(r.pairs.length, 1);
  assert.deepEqual(r.pairs[0].pair, ["apex-developer", "architect"]);
  assert.equal(r.pairs[0].cooccurrence, 3);
  // lift = (3*3)/(3*3) = 1
  assert.equal(r.pairs[0].lift, 1);
  assert.ok(r.pairs[0].score > 0);
});

test("A6: lift is higher when pair always co-occurs vs noisy independent agents", () => {
  const sessions: AgentSynergyChatSession[] = [
    makeSession(["a", "b"]),
    makeSession(["a", "b"]),
    makeSession(["c", "d"]),
    makeSession(["e", "f"]),
    makeSession(["g", "h"])
  ];
  const r = scoreAgentSynergy(sessions, { limit: 5 });
  // a-b co-occurs in 2/5 sessions; both individual probability 2/5
  // lift = (2 * 5) / (2 * 2) = 2.5
  const ab = r.pairs.find((p) => p.pair[0] === "a" && p.pair[1] === "b");
  assert.ok(ab, "expected a-b pair");
  assert.equal(ab!.lift, 2.5);
});

test("A6: minCooccurrence filters out rare pairs", () => {
  const r = scoreAgentSynergy(
    [
      makeSession(["a", "b"]),
      makeSession(["c", "d"]),
      makeSession(["a", "b"])
    ],
    { minCooccurrence: 2 }
  );
  assert.equal(r.pairs.length, 1);
  assert.deepEqual(r.pairs[0].pair, ["a", "b"]);
});

test("A6: limit truncates result list", () => {
  const sessions: AgentSynergyChatSession[] = [];
  for (const x of ["a", "b", "c", "d"]) {
    for (const y of ["e", "f", "g", "h"]) {
      sessions.push(makeSession([x, y]));
    }
  }
  const r = scoreAgentSynergy(sessions, { limit: 3 });
  assert.equal(r.pairs.length, 3);
});

test("A6: duplicate agents in session.agents are deduplicated", () => {
  const r = scoreAgentSynergy([
    { agents: ["a", "a", "b"], entries: [{ agent: "a" }] },
    { agents: ["a", "b"], entries: [{ agent: "b" }] }
  ]);
  // Should have only one a-b pair, cooccurrence=2
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].cooccurrence, 2);
});

test("A6: avgEntries reflects entry counts per session", () => {
  const r = scoreAgentSynergy([
    {
      agents: ["a", "b"],
      entries: [
        { agent: "a" },
        { agent: "a" },
        { agent: "a" },
        { agent: "b" }
      ]
    }
  ]);
  const ab = r.pairs[0];
  assert.equal(ab.avgEntriesA, 3);
  assert.equal(ab.avgEntriesB, 1);
});

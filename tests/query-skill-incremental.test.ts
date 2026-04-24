import test from "node:test";
import assert from "node:assert/strict";

import {
  QUERY_SKILL_MODEL_VERSION,
  applyQuerySkillIncrementalScore,
  buildQuerySkillIncrementalModel,
  type QuerySkillFeedbackEntry
} from "../mcp/core/resource/query-skill-incremental.js";

test("buildQuerySkillIncrementalModel sets version and accumulates token weights", () => {
  const entries: QuerySkillFeedbackEntry[] = [
    {
      query: "Apex trigger security review",
      skill: "security/permission-audit",
      decision: "accepted",
      recordedAt: "2026-04-24T00:00:00.000Z"
    },
    {
      query: "Apex trigger performance tuning",
      skill: "performance/performance-profile",
      decision: "accepted",
      recordedAt: "2026-04-24T00:01:00.000Z"
    },
    {
      query: "Apex trigger security review",
      skill: "security/permission-audit",
      decision: "rejected",
      recordedAt: "2026-04-24T00:02:00.000Z"
    }
  ];

  const model = buildQuerySkillIncrementalModel(entries);
  assert.equal(model.modelVersion, QUERY_SKILL_MODEL_VERSION);
  assert.equal(model.totals.total, 3);
  assert.ok(model.skills.length >= 2);
  const security = model.skills.find((row) => row.skill === "security/permission-audit");
  assert.ok(security);
  assert.ok(typeof security?.tokenWeights["security"] === "number");
});

test("applyQuerySkillIncrementalScore adjusts score for matching learned query", () => {
  const entries: QuerySkillFeedbackEntry[] = [
    {
      query: "release security checklist",
      skill: "security/security-rules",
      decision: "accepted",
      recordedAt: "2026-04-24T00:00:00.000Z"
    },
    {
      query: "release security checklist",
      skill: "security/security-rules",
      decision: "accepted",
      recordedAt: "2026-04-24T00:01:00.000Z"
    }
  ];
  const model = buildQuerySkillIncrementalModel(entries);
  const boosted = applyQuerySkillIncrementalScore(10, "security release", "security/security-rules", model);
  const untouched = applyQuerySkillIncrementalScore(10, "lwc ui", "security/security-rules", model);

  assert.ok(boosted > untouched);
  assert.ok(boosted >= 10);
});
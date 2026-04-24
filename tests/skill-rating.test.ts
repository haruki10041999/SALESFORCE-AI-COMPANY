import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkillRatingModel,
  renderSkillRatingMarkdown,
  type SkillRatingEntry
} from "../mcp/core/resource/skill-rating.js";

test("buildSkillRatingModel flags low-rated skill and computes trend", () => {
  const entries: SkillRatingEntry[] = [
    { skill: "apex/trigger-audit", rating: 5, recordedAt: "2026-04-20T00:00:00.000Z" },
    { skill: "apex/trigger-audit", rating: 4, recordedAt: "2026-04-21T00:00:00.000Z" },
    { skill: "apex/trigger-audit", rating: 2, recordedAt: "2026-04-22T00:00:00.000Z" },
    { skill: "apex/trigger-audit", rating: 1, recordedAt: "2026-04-23T00:00:00.000Z" },
    { skill: "security/permission-audit", rating: 5, recordedAt: "2026-04-21T00:00:00.000Z" }
  ];

  const model = buildSkillRatingModel(entries, 2, 3, 0.5);

  assert.equal(model.totals.count, 5);
  const apexRow = model.skills.find((row) => row.skill === "apex/trigger-audit");
  assert.ok(apexRow);
  assert.equal(apexRow?.flaggedForRefactor, true);
  assert.ok((apexRow?.trendDelta ?? 0) < 0);
});

test("renderSkillRatingMarkdown includes table header", () => {
  const model = buildSkillRatingModel([], 5, 3, 0.5);
  const markdown = renderSkillRatingMarkdown(model);
  assert.ok(markdown.includes("# Skill Rating Report"));
});

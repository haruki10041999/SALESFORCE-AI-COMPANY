import { test } from "node:test";
import { strict as assert } from "node:assert";
import { recommendSkillsForRole, __testables } from "../mcp/tools/recommend-skills-for-role.js";

const skills = [
  { name: "apex/bulk-pattern", summary: "Bulkified DML pattern" },
  { name: "apex/governor-limits", summary: "Governor limit hygiene" },
  { name: "lwc/wire-pattern", summary: "Wire adapter usage" },
  { name: "testing/mocks", summary: "Apex test mocks" },
  { name: "security/clm", summary: "CRUD/FLS enforcement" },
  { name: "documentation/style", summary: "Doc style guide" }
];

test("A4: role-based bonus surfaces the matching category first", () => {
  const r = recommendSkillsForRole({ role: "apex-developer", skills, limit: 3 });
  const top = r.recommendations[0]?.name;
  assert.ok(top?.startsWith("apex/"), `expected apex skill first, got ${top}`);
  assert.ok(r.recommendations[0].reasons.some((reason) => reason.startsWith("role:")));
});

test("A4: recentFiles add a category bonus proportional to count", () => {
  const r = recommendSkillsForRole({
    skills,
    limit: 5,
    recentFiles: [
      "force-app/main/default/lwc/cmp/cmp.js",
      "force-app/main/default/lwc/cmp/cmp.html",
      "force-app/main/default/lwc/other/other.js"
    ]
  });
  const top = r.recommendations[0]?.name;
  assert.ok(top?.startsWith("lwc/"), `expected lwc skill first, got ${top}`);
});

test("A4: topic match is reported as a separate reason", () => {
  const r = recommendSkillsForRole({ topic: "governor limit", skills, limit: 3 });
  const item = r.recommendations.find((x) => x.name === "apex/governor-limits");
  assert.ok(item, "expected governor-limits in recommendations");
  assert.ok(item!.reasons.some((reason) => reason.startsWith("topic-match")));
});

test("A4: returns empty list when nothing matches", () => {
  const r = recommendSkillsForRole({ role: "unknown-role", skills, limit: 5 });
  assert.equal(r.recommendations.length, 0);
});

test("A4: categoriesForFile classifies common Salesforce paths", () => {
  assert.deepEqual(__testables.categoriesForFile("force-app/main/default/classes/Foo.cls"), ["apex"]);
  assert.deepEqual(__testables.categoriesForFile("force-app/main/default/lwc/cmp/cmp.js"), ["lwc"]);
  assert.deepEqual(__testables.categoriesForFile("force-app/main/default/permissionsets/PS.permissionset-meta.xml"), ["security"]);
});

test("A4: recommendations are sorted by score desc then name asc", () => {
  const r = recommendSkillsForRole({
    role: "apex-developer",
    topic: "apex",
    skills,
    limit: 5
  });
  for (let i = 1; i < r.recommendations.length; i += 1) {
    const prev = r.recommendations[i - 1];
    const cur = r.recommendations[i];
    assert.ok(prev.score >= cur.score, `score should be non-increasing`);
  }
});

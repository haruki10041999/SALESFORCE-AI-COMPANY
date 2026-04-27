import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderGovernanceUi } from "../mcp/core/governance/governance-ui.js";
import { buildDefaultGovernanceState } from "../mcp/core/governance/governance-state.js";

const NOW = new Date("2026-04-27T00:00:00Z");

function makeState() {
  const s = buildDefaultGovernanceState([]);
  s.usage.skills["apex/bulk"] = 5;
  s.usage.skills["lwc/wire"] = 2;
  s.usage.tools["chat"] = 10;
  s.bugSignals.skills["apex/bulk"] = 3;
  s.bugSignals.tools["chat"] = 1;
  s.disabled.skills = ["legacy/skill"];
  return s;
}

test("A3: report includes generatedAt and totals", () => {
  const r = renderGovernanceUi(makeState(), { generatedAt: NOW });
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.equal(r.totals.disabled, 1);
  // bugSignalToFlag default = 2; only apex/bulk(3) qualifies
  assert.equal(r.totals.flagged, 1);
});

test("A3: section data is built per resource type", () => {
  const r = renderGovernanceUi(makeState(), { generatedAt: NOW });
  const skills = r.sections.find((s) => s.resourceType === "skills")!;
  assert.equal(skills.totalUsage, 7);
  assert.equal(skills.totalDisabled, 1);
  assert.equal(skills.flagged.length, 1);
  assert.equal(skills.flagged[0].name, "apex/bulk");
  assert.equal(skills.topUsage[0].name, "apex/bulk");
});

test("A3: HTML escapes potentially malicious names", () => {
  const s = buildDefaultGovernanceState([]);
  s.usage.skills["<script>alert(1)</script>"] = 1;
  const r = renderGovernanceUi(s, { generatedAt: NOW });
  assert.ok(r.html.includes("&lt;script&gt;"));
  assert.ok(!r.html.includes("<script>alert(1)</script>"));
});

test("A3: markdown output includes section headings", () => {
  const r = renderGovernanceUi(makeState(), { generatedAt: NOW, title: "GOV" });
  assert.ok(r.markdown.startsWith("# GOV"));
  assert.ok(r.markdown.includes("## skills"));
  assert.ok(r.markdown.includes("## tools"));
  assert.ok(r.markdown.includes("## presets"));
});

test("A3: topPerType limits topUsage entries", () => {
  const s = buildDefaultGovernanceState([]);
  for (let i = 0; i < 20; i += 1) s.usage.skills[`s${i}`] = 100 - i;
  const r = renderGovernanceUi(s, { generatedAt: NOW, topPerType: 3 });
  const skills = r.sections.find((x) => x.resourceType === "skills")!;
  assert.equal(skills.topUsage.length, 3);
  assert.equal(skills.topUsage[0].name, "s0");
});

test("A3: HTML is well-formed and contains kpi data", () => {
  const r = renderGovernanceUi(makeState(), { generatedAt: NOW });
  assert.ok(r.html.includes("<!doctype html>"));
  assert.ok(r.html.includes("Disabled:"));
  assert.ok(r.html.includes("Flagged:"));
});

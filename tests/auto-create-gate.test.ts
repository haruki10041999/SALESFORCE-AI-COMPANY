import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  evaluateAutoCreateGate,
  countTodayApplied,
  DEFAULT_AUTO_CREATE_CONFIG,
  type AutoCreateConfig
} from "../mcp/core/resource/proposal/auto-create-gate.js";
import type { ProposalRecord, ProposalResourceType } from "../mcp/core/resource/proposal/queue.js";

function p(partial: Partial<ProposalRecord> & { resourceType: ProposalResourceType }): ProposalRecord {
  return {
    id: "prop-x",
    resourceType: partial.resourceType,
    name: partial.name ?? "demo",
    content: partial.content ?? "x",
    confidence: partial.confidence ?? 0.9,
    status: partial.status ?? "pending",
    createdAt: partial.createdAt ?? new Date().toISOString()
  };
}

const empty = { skills: 0, tools: 0, presets: 0 };

test("Phase3: default config rejects all (opt-in required)", () => {
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "presets", confidence: 1.0 }),
    config: DEFAULT_AUTO_CREATE_CONFIG,
    todayAppliedCount: empty
  });
  assert.equal(d.allow, false);
  assert.equal(d.reasonCode, "type-disabled");
});

test("Phase3: rejects when status is not pending", () => {
  const cfg: AutoCreateConfig = { ...DEFAULT_AUTO_CREATE_CONFIG, presets: { enabled: true, threshold: 0.5, maxPerDay: 1 } };
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "presets", status: "approved" }),
    config: cfg,
    todayAppliedCount: empty
  });
  assert.equal(d.allow, false);
  assert.equal(d.reasonCode, "not-pending");
});

test("Phase3: rejects below threshold", () => {
  const cfg: AutoCreateConfig = { ...DEFAULT_AUTO_CREATE_CONFIG, skills: { enabled: true, threshold: 0.9, maxPerDay: 5 } };
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "skills", confidence: 0.7 }),
    config: cfg,
    todayAppliedCount: empty
  });
  assert.equal(d.allow, false);
  assert.equal(d.reasonCode, "below-threshold");
});

test("Phase3: rejects when daily limit reached", () => {
  const cfg: AutoCreateConfig = { ...DEFAULT_AUTO_CREATE_CONFIG, tools: { enabled: true, threshold: 0.5, maxPerDay: 1 } };
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "tools" }),
    config: cfg,
    todayAppliedCount: { skills: 0, tools: 1, presets: 0 }
  });
  assert.equal(d.allow, false);
  assert.equal(d.reasonCode, "daily-limit-reached");
});

test("Phase3: rejects denyList match", () => {
  const cfg: AutoCreateConfig = { ...DEFAULT_AUTO_CREATE_CONFIG, presets: { enabled: true, threshold: 0.5, maxPerDay: 5 } };
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "presets", name: "blocked" }),
    config: cfg,
    todayAppliedCount: empty,
    denyList: [{ resourceType: "presets", name: "blocked" }]
  });
  assert.equal(d.allow, false);
  assert.equal(d.reasonCode, "denied-by-list");
});

test("Phase3: allows when all gates pass", () => {
  const cfg: AutoCreateConfig = { ...DEFAULT_AUTO_CREATE_CONFIG, presets: { enabled: true, threshold: 0.7, maxPerDay: 5 } };
  const d = evaluateAutoCreateGate({
    proposal: p({ resourceType: "presets", confidence: 0.8 }),
    config: cfg,
    todayAppliedCount: empty
  });
  assert.equal(d.allow, true);
});

test("Phase3: countTodayApplied counts only today's approved records by type", () => {
  const today = new Date("2025-01-15T12:00:00Z");
  const records: ProposalRecord[] = [
    { id: "1", resourceType: "skills", name: "a", content: "", confidence: 1, status: "approved", createdAt: "", resolvedAt: "2025-01-15T01:00:00Z" },
    { id: "2", resourceType: "skills", name: "b", content: "", confidence: 1, status: "approved", createdAt: "", resolvedAt: "2025-01-14T23:00:00Z" },
    { id: "3", resourceType: "tools", name: "c", content: "", confidence: 1, status: "approved", createdAt: "", resolvedAt: "2025-01-15T08:00:00Z" },
    { id: "4", resourceType: "tools", name: "d", content: "", confidence: 1, status: "rejected", createdAt: "", resolvedAt: "2025-01-15T08:00:00Z" }
  ];
  const counts = countTodayApplied(records, today);
  assert.deepEqual(counts, { skills: 1, tools: 1, presets: 0 });
});

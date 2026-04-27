import { test } from "node:test";
import { strict as assert } from "node:assert";
import { visualizeFeedbackLoop } from "../mcp/core/resource/feedback-loop-visualization.js";
import type { ProposalFeedbackEntry } from "../mcp/core/resource/proposal-feedback.js";

const NOW = new Date("2026-04-27T00:00:00Z");

function entry(
  daysAgo: number,
  decision: ProposalFeedbackEntry["decision"],
  opts: Partial<ProposalFeedbackEntry> = {}
): ProposalFeedbackEntry {
  const recordedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    resourceType: opts.resourceType ?? "skills",
    name: opts.name ?? "skill-x",
    decision,
    topic: opts.topic,
    note: opts.note,
    recordedAt
  };
}

test("A16: totals reflect period accept/reject counts", () => {
  const r = visualizeFeedbackLoop(
    [
      entry(1, "accepted"),
      entry(2, "accepted"),
      entry(3, "rejected"),
      entry(60, "accepted") // outside default 30d window
    ],
    { now: NOW }
  );
  assert.equal(r.totals.accepted, 2);
  assert.equal(r.totals.rejected, 1);
  assert.equal(r.totals.total, 3);
  assert.equal(r.totals.acceptRate, 0.6667);
});

test("A16: rejectReasonShare sums to 1 when there are rejections", () => {
  const r = visualizeFeedbackLoop(
    [
      entry(1, "reject_inaccurate"),
      entry(1, "reject_inaccurate"),
      entry(1, "reject_duplicate"),
      entry(1, "accepted")
    ],
    { now: NOW }
  );
  const total = Object.values(r.rejectReasonShare).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 0.01);
});

test("A16: timeline aggregates per day", () => {
  const r = visualizeFeedbackLoop(
    [
      entry(1, "accepted"),
      entry(1, "rejected"),
      entry(2, "accepted")
    ],
    { now: NOW }
  );
  assert.equal(r.timeline.length, 2);
  // sorted by date asc
  assert.ok(r.timeline[0].date < r.timeline[1].date);
});

test("A16: heatmap groups by topic+resource and respects minSamples", () => {
  const r = visualizeFeedbackLoop(
    [
      entry(1, "accepted", { topic: "apex", name: "skill-a" }),
      entry(1, "rejected", { topic: "apex", name: "skill-a" }),
      entry(1, "accepted", { topic: "apex", name: "skill-a" }),
      entry(1, "accepted", { topic: "lwc", name: "skill-b" })
    ],
    { now: NOW, minSamples: 2 }
  );
  assert.equal(r.heatmap.length, 1);
  assert.equal(r.heatmap[0].topic, "apex");
  assert.equal(r.heatmap[0].total, 3);
  assert.equal(r.heatmap[0].acceptRate, 0.6667);
});

test("A16: trends.rising surfaces resources whose accept rate improved", () => {
  // recent (0-13d): 5 accepted / 0 rejected → 1.0
  // previous (14-27d): 0 accepted / 5 rejected → 0.0
  const recent = Array.from({ length: 5 }, (_, i) => entry(i, "accepted", { name: "improving" }));
  const prev = Array.from({ length: 5 }, (_, i) => entry(15 + i, "rejected", { name: "improving" }));
  const r = visualizeFeedbackLoop([...recent, ...prev], { now: NOW, minSamples: 2 });
  const found = r.trends.rising.find((t) => t.name === "improving");
  assert.ok(found, "expected rising trend");
  assert.equal(found!.delta, 1);
});

test("A16: trends.falling surfaces resources whose accept rate regressed", () => {
  const recent = Array.from({ length: 5 }, (_, i) => entry(i, "rejected", { name: "regressing" }));
  const prev = Array.from({ length: 5 }, (_, i) => entry(15 + i, "accepted", { name: "regressing" }));
  const r = visualizeFeedbackLoop([...recent, ...prev], { now: NOW, minSamples: 2 });
  const found = r.trends.falling.find((t) => t.name === "regressing");
  assert.ok(found, "expected falling trend");
  assert.equal(found!.delta, -1);
});

test("A16: empty input returns zero totals and empty arrays", () => {
  const r = visualizeFeedbackLoop([], { now: NOW });
  assert.equal(r.totals.total, 0);
  assert.equal(r.timeline.length, 0);
  assert.equal(r.heatmap.length, 0);
  assert.equal(r.trends.rising.length, 0);
  assert.equal(r.trends.falling.length, 0);
});

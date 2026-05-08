import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDataRetentionPolicy,
  resolveRetentionTargets,
  DEFAULT_RETENTION_DAYS
} from "../mcp/core/governance/data-retention.js";

test("buildDataRetentionPolicy uses default retention days", () => {
  const policy = buildDataRetentionPolicy({});
  const map = new Map(policy.map((item) => [item.classification, item.retentionDays]));

  assert.equal(map.get("public"), DEFAULT_RETENTION_DAYS.public);
  assert.equal(map.get("internal"), DEFAULT_RETENTION_DAYS.internal);
  assert.equal(map.get("confidential"), DEFAULT_RETENTION_DAYS.confidential);
  assert.equal(map.get("restricted"), DEFAULT_RETENTION_DAYS.restricted);
});

test("buildDataRetentionPolicy accepts env overrides", () => {
  const policy = buildDataRetentionPolicy({
    SF_AI_RETENTION_DAYS_PUBLIC: "700",
    SF_AI_RETENTION_DAYS_INTERNAL: "120",
    SF_AI_RETENTION_DAYS_CONFIDENTIAL: "45",
    SF_AI_RETENTION_DAYS_RESTRICTED: "7"
  });
  const map = new Map(policy.map((item) => [item.classification, item.retentionDays]));

  assert.equal(map.get("public"), 700);
  assert.equal(map.get("internal"), 120);
  assert.equal(map.get("confidential"), 45);
  assert.equal(map.get("restricted"), 7);
});

test("resolveRetentionTargets maps classification to retention days", () => {
  const policy = buildDataRetentionPolicy({
    SF_AI_RETENTION_DAYS_PUBLIC: "400",
    SF_AI_RETENTION_DAYS_INTERNAL: "200",
    SF_AI_RETENTION_DAYS_CONFIDENTIAL: "80",
    SF_AI_RETENTION_DAYS_RESTRICTED: "20"
  });

  const targets = resolveRetentionTargets(policy);
  const reports = targets.find((item) => item.relativeDir === "reports");
  const history = targets.find((item) => item.relativeDir === "history");
  const events = targets.find((item) => item.relativeDir === "events");

  assert.equal(reports?.retentionDays, 400);
  assert.equal(history?.retentionDays, 200);
  assert.equal(events?.retentionDays, 80);
});

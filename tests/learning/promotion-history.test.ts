import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLearningPromotionHistory,
  buildPolicySnapshotTag,
  createPolicySnapshotTag,
  loadLearningPromotionHistory
} from "../../mcp/core/learning/promotion-history.js";

test("promotion history appends and loads latest entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-ai-promotion-history-"));
  const historyPath = join(dir, "promotion-history.jsonl");

  await appendLearningPromotionHistory(historyPath, {
    modelName: "ranker",
    stage: "canary",
    action: "start_canary",
    reason: "candidate-ready",
    candidateVersion: "v2",
    currentProductionVersion: "v1",
    dag: [],
    occurredAt: "2026-05-14T00:00:00.000Z"
  });

  await appendLearningPromotionHistory(historyPath, {
    modelName: "ranker",
    stage: "promoted",
    action: "promote",
    reason: "policy-satisfied",
    candidateVersion: "v2",
    currentProductionVersion: "v2",
    previousVersion: "v1",
    policySnapshotTag: "policy-snapshot:ranker@v2",
    dag: [],
    occurredAt: "2026-05-14T01:00:00.000Z"
  });

  const entries = await loadLearningPromotionHistory(historyPath, 5);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.stage, "promoted");
  assert.equal(entries[1]?.stage, "canary");
});

test("createPolicySnapshotTag persists snapshot payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-ai-policy-snapshot-"));
  const tag = await createPolicySnapshotTag(dir, {
    modelName: "ranker",
    candidateVersion: "v2",
    productionVersion: "v2",
    reason: "policy-satisfied",
    snapshot: {
      models: [
        {
          name: "ranker",
          productionVersion: "v2",
          versionList: ["v1", "v2"],
          shadowVersions: [],
          history: ["v2", "v1"],
          evaluations: []
        }
      ]
    }
  });

  assert.ok(tag.startsWith("policy-snapshot:ranker@v2:"));

  const files = readFileSync(join(dir, `${tag.replace(/[^a-zA-Z0-9._@:-]/g, "-").replace(/[:]/g, "_")}.json`), "utf-8");
  assert.ok(files.includes("\"modelName\": \"ranker\""));
});

test("buildPolicySnapshotTag includes model and candidate", () => {
  const tag = buildPolicySnapshotTag("router", "v3", new Date("2026-05-14T10:11:12.000Z"));
  assert.ok(tag.startsWith("policy-snapshot:router@v3:"));
});

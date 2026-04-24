import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendProposalFeedback,
  applyProposalFeedbackScore,
  buildProposalFeedbackModel,
  loadProposalFeedbackLog,
  loadProposalFeedbackModel,
  saveProposalFeedbackModel
} from "../mcp/core/resource/proposal-feedback.js";

test("proposal feedback model is built from accepted/rejected logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-feedback-"));
  const logFile = join(root, "proposal-feedback.jsonl");

  try {
    await appendProposalFeedback(logFile, [
      { resourceType: "skills", name: "security/apex-sharing", decision: "accepted", recordedAt: "2026-04-24T00:00:00.000Z" },
      { resourceType: "skills", name: "security/apex-sharing", decision: "accepted", recordedAt: "2026-04-24T00:01:00.000Z" },
      { resourceType: "skills", name: "security/apex-sharing", decision: "rejected", recordedAt: "2026-04-24T00:02:00.000Z" },
      { resourceType: "tools", name: "run_tests", decision: "rejected", recordedAt: "2026-04-24T00:03:00.000Z" },
      { resourceType: "tools", name: "run_tests", decision: "rejected", recordedAt: "2026-04-24T00:04:00.000Z" },
      { resourceType: "tools", name: "run_tests", decision: "rejected", recordedAt: "2026-04-24T00:05:00.000Z" }
    ]);

    const entries = await loadProposalFeedbackLog(logFile);
    const model = buildProposalFeedbackModel(entries, 2);

    assert.equal(model.totals.total, 6);

    const skill = model.resources.find((row) => row.resourceType === "skills" && row.name === "security/apex-sharing");
    const tool = model.resources.find((row) => row.resourceType === "tools" && row.name === "run_tests");

    assert.ok(skill);
    assert.ok(tool);
    assert.ok((skill?.adjustment ?? 0) > 0);
    assert.ok((tool?.adjustment ?? 0) < 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyProposalFeedbackScore adjusts recommendation score from model", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-feedback-model-"));
  const modelFile = join(root, "proposal-feedback-model.json");

  try {
    const model = buildProposalFeedbackModel(
      [
        { resourceType: "presets", name: "Salesforce 開発レビュー", decision: "accepted", recordedAt: "2026-04-24T00:00:00.000Z" },
        { resourceType: "presets", name: "Salesforce 開発レビュー", decision: "accepted", recordedAt: "2026-04-24T00:01:00.000Z" },
        { resourceType: "presets", name: "Salesforce 開発レビュー", decision: "accepted", recordedAt: "2026-04-24T00:02:00.000Z" }
      ],
      2
    );
    await saveProposalFeedbackModel(modelFile, model);

    const loaded = await loadProposalFeedbackModel(modelFile);
    const baseScore = 10;
    const adjusted = applyProposalFeedbackScore(baseScore, "presets", "Salesforce 開発レビュー", loaded);

    assert.ok(adjusted > baseScore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

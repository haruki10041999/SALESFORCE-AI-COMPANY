import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendOutputRatioFeedback,
  loadOutputRatioFeedback,
  summarizeOutputRatioByModel,
  writePricingFromOutputRatioFeedback
} from "../mcp/core/learning/cost-feedback.js";

test("cost-feedback appends and summarizes output ratios by model/agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-cost-feedback-"));
  const feedbackFile = join(root, "output-ratio.jsonl");

  try {
    await appendOutputRatioFeedback(feedbackFile, {
      model: "mistral",
      agent: "architect",
      inputTokens: 100,
      outputTokens: 30
    });
    await appendOutputRatioFeedback(feedbackFile, {
      model: "mistral",
      agent: "architect",
      inputTokens: 200,
      outputTokens: 40
    });
    await appendOutputRatioFeedback(feedbackFile, {
      model: "mistral",
      agent: "qa-engineer",
      inputTokens: 100,
      outputTokens: 20
    });

    const loaded = await loadOutputRatioFeedback(feedbackFile);
    const summary = summarizeOutputRatioByModel(loaded, { minSamplesPerAgent: 1 });

    assert.equal(loaded.length, 3);
    assert.equal(summary.length, 1);
    assert.equal(summary[0]?.model, "mistral");
    assert.equal(summary[0]?.totalSamples, 3);
    assert.ok((summary[0]?.averageOutputRatio ?? 0) > 0);
    assert.equal(summary[0]?.byAgent.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cost-feedback writes pricing feedback fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-cost-pricing-"));
  const pricingFile = join(root, "outputs", "pricing.json");

  try {
    await mkdir(join(root, "outputs"), { recursive: true });
    await writePricingFromOutputRatioFeedback(pricingFile, [
      {
        model: "mistral",
        totalSamples: 5,
        averageOutputRatio: 0.27,
        byAgent: [{ agent: "architect", sampleCount: 5, averageOutputRatio: 0.27 }]
      }
    ]);

    const raw = await readFile(pricingFile, "utf-8");
    const parsed = JSON.parse(raw) as {
      models?: Record<string, { feedbackOutputRatio?: number; feedbackOutputRatioByAgent?: Record<string, unknown> }>;
    };

    assert.equal(parsed.models?.mistral?.feedbackOutputRatio, 0.27);
    assert.ok(parsed.models?.mistral?.feedbackOutputRatioByAgent?.architect);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

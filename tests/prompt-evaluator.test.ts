import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { estimatePromptCost, type PromptMetrics } from "../prompt-engine/prompt-evaluator.js";

const BASE_METRICS: PromptMetrics = {
  lengthChars: 120,
  lineCount: 4,
  estimatedTokens: 800,
  tokenMethod: "tiktoken",
  containsProjectContext: true,
  containsAgentsSection: true,
  containsSkillsSection: false,
  containsTaskSection: true,
  matchedSkillCount: 0,
  totalSkillCount: 0,
  matchedTriggerCount: 0,
  totalTriggerCount: 0,
  skillCoverageRate: 1,
  triggerMatchRate: 1
};

test("prompt-evaluator: estimatePromptCost uses fallback pricing when outputs/pricing.json is absent", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "sf-ai-prompt-evaluator-fallback-"));

  try {
    process.chdir(root);
    const estimate = estimatePromptCost(BASE_METRICS, "mistral", 240);

    assert.equal(estimate.model, "mistral");
    assert.equal(estimate.currency, "USD");
    assert.equal(estimate.breakdown.tierApplied, "interactive");
    assert.equal(estimate.inputCost, 0.04);
    assert.equal(estimate.outputCost, 0.036);
    assert.equal(estimate.totalCost, 0.076);
    assert.deepEqual(estimate.notes, []);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("prompt-evaluator: estimatePromptCost honors pricing.json overrides and tier discount", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "sf-ai-prompt-evaluator-"));

  try {
    await mkdir(join(root, "outputs"), { recursive: true });
    await writeFile(
      join(root, "outputs", "pricing.json"),
      JSON.stringify(
        {
          models: {
            "local-mistral": {
              inputTokenRate: 0.002,
              outputTokenRate: 0.003,
              currency: "JPY",
              provider: "local-ollama"
            }
          },
          tiers: {
            bulk: {
              discount: 0.5
            }
          },
          defaults: {
            primaryModel: "local-mistral",
            currency: "JPY"
          }
        },
        null,
        2
      ),
      "utf-8"
    );

    process.chdir(root);
    const estimate = estimatePromptCost({ ...BASE_METRICS, estimatedTokens: 12000 }, "local-mistral", 6000);

    assert.equal(estimate.currency, "JPY");
    assert.equal(estimate.breakdown.tierApplied, "bulk");
    assert.equal(estimate.breakdown.discountRate, 0.5);
    assert.equal(estimate.inputCost, 12);
    assert.equal(estimate.outputCost, 9);
    assert.equal(estimate.totalCost, 21);
    assert.ok(estimate.notes.some((note) => note.includes("ローカル実行")));
    assert.ok(estimate.notes.some((note) => note.includes("50% 割引")));
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
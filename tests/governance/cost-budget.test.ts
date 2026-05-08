import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CostBudgetManager, buildCostUsageFromInputOutput } from "../../mcp/core/governance/cost-budget.js";

async function setupFixture(config: Record<string, unknown>): Promise<{
  root: string;
  outputsDir: string;
  configPath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "sfai-cost-budget-"));
  const outputsDir = join(root, "outputs");
  const configDir = join(root, "config", "budgets");
  const configPath = join(configDir, "default.yaml");
  await mkdir(outputsDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  return {
    root,
    outputsDir,
    configPath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("cost budget blocks when actor daily usd exceeds limit", async () => {
  const fx = await setupFixture({
    version: "1.0",
    currency: "USD",
    defaultModel: "mistral",
    outputTokenRatio: 0.3,
    limits: {
      actorPerDay: { usd: 0.0002 },
      globalPerDay: { usd: 1 }
    }
  });

  const manager = new CostBudgetManager({ outputsDir: fx.outputsDir, configPath: fx.configPath });
  try {
    const first = await manager.assertWithin({
      toolName: "smart_chat",
      actorId: "actor-a",
      model: "mistral",
      inputTokens: 1,
      outputTokens: 1
    });
    assert.equal(first.allowed, true);

    await manager.recordUsage({
      ts: new Date().toISOString(),
      toolName: "smart_chat",
      actorId: "actor-a",
      model: "mistral",
      inputTokens: 2,
      outputTokens: 2,
      usdEstimate: manager.estimateUsd("mistral", 2, 2),
      status: "success"
    });

    const second = await manager.assertWithin({
      toolName: "smart_chat",
      actorId: "actor-a",
      model: "mistral",
      inputTokens: 2,
      outputTokens: 2
    });

    assert.equal(second.allowed, false);
    assert.match(second.reason ?? "", /actor\/day/);
  } finally {
    await fx.cleanup();
  }
});

test("cost budget blocks when session token budget exceeds limit", async () => {
  const fx = await setupFixture({
    version: "1.0",
    currency: "USD",
    defaultModel: "mistral",
    outputTokenRatio: 0.3,
    limits: {
      session: { totalTokens: 10 },
      globalPerDay: { totalTokens: 1000 }
    }
  });

  const manager = new CostBudgetManager({ outputsDir: fx.outputsDir, configPath: fx.configPath });
  try {
    await manager.recordUsage({
      ts: new Date().toISOString(),
      toolName: "chat",
      actorId: "actor-a",
      sessionId: "sess-1",
      model: "mistral",
      inputTokens: 6,
      outputTokens: 3,
      usdEstimate: manager.estimateUsd("mistral", 6, 3),
      status: "success"
    });

    const check = await manager.assertWithin({
      toolName: "chat",
      actorId: "actor-a",
      sessionId: "sess-1",
      model: "mistral",
      inputTokens: 2,
      outputTokens: 2
    });

    assert.equal(check.allowed, false);
    assert.match(check.reason ?? "", /session:/);
  } finally {
    await fx.cleanup();
  }
});

test("buildCostUsageFromInputOutput estimates tokens from summaries", () => {
  const usage = buildCostUsageFromInputOutput({
    inputSummary: "hello world",
    outputRatio: 0.3
  });

  assert.ok(usage.inputTokens > 0);
  assert.ok(usage.outputTokens > 0);
});

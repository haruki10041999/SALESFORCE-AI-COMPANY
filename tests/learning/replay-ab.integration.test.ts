import { test } from "node:test";
import assert from "node:assert";
import { ReplayABEvaluator, type ABTestResult } from "../../mcp/core/learning/replay-ab.js";
import { migrateSessionSnapshot } from "../../mcp/core/recording/snapshot-migrator.js";
import type { SessionSnapshot } from "../../mcp/core/recording/session-snapshot.js";

test("ReplayABEvaluator runs variant and returns result", async () => {
  const evaluator = new ReplayABEvaluator();
  const snapshot: SessionSnapshot = {
    schemaVersion: 2,
    id: "session-1",
    tenantId: "tenant-1",
    sessionType: "agent-session",
    systemPrompt: "You are helpful",
    turns: [
      {
        turn: 1,
        input: "What is 2+2?",
        output: "2+2=4",
        agentsInvolved: ["math-agent"],
        skillsUsed: ["arithmetic"],
        toolsUsed: [],
        duration: 100,
      },
    ],
    toolExecutions: [
      { tool: "calculator", args: { expr: "2+2" }, status: "success" },
    ],
    feedback: {
      score: 0.9,
      scoreAdjustment: 10,
      comment: "Good response",
    },
    metrics: {
      tokenUsage: {
        total: 100,
        input: 50,
        output: 50,
      },
    },
    createdAt: new Date(),
    status: "completed",
  };

  const variantConfig = {
    promptTemplate: {
      name: "v2",
      content: "You are a helpful AI assistant v2",
    },
  };

  const result = await evaluator.runVariant(
    snapshot,
    variantConfig,
    "prompt-v2",
    "prompt_template",
  );

  assert.ok(result.testId);
  assert.equal(result.sessionId, snapshot.id);
  assert.equal(result.variantId, "prompt-v2");
  assert.ok(result.controlScore >= 0 && result.controlScore <= 100);
  assert.ok(result.variantScore >= 0 && result.variantScore <= 100);
  assert.ok(["control", "variant", "tie"].includes(result.winner));
  assert.ok(result.scorerVersion);
  assert.equal(result.snapshotSchemaVersion, 2);
});

test("ReplayABEvaluator ranks variants by score", async () => {
  const results: ABTestResult[] = [
    {
      testId: "t1",
      sessionId: "s1",
      variantId: "v1",
      variantType: "prompt_template",
      variantConfig: {},
      controlScore: 50,
      variantScore: 55,
      scoreDiff: 5,
      winner: "variant",
      isSignificant: false,
      confidenceLevel: 0.5,
      scorerVersion: "v1",
      snapshotSchemaVersion: 2,
    },
    {
      testId: "t2",
      sessionId: "s1",
      variantId: "v2",
      variantType: "prompt_template",
      variantConfig: {},
      controlScore: 50,
      variantScore: 70,
      scoreDiff: 20,
      winner: "variant",
      isSignificant: true,
      confidenceLevel: 0.9,
      scorerVersion: "v1",
      snapshotSchemaVersion: 2,
    },
  ];

  const evaluator = new ReplayABEvaluator();
  const ranked = evaluator.rankVariants(results);

  assert.equal(ranked[0].variantId, "v2"); // Higher score first
  assert.equal(ranked[1].variantId, "v1");
});

test("ReplayABEvaluator filters significant winners", async () => {
  const results: ABTestResult[] = [
    {
      testId: "t1",
      sessionId: "s1",
      variantId: "v1",
      variantType: "prompt_template",
      variantConfig: {},
      controlScore: 50,
      variantScore: 51,
      scoreDiff: 1,
      winner: "variant",
      isSignificant: false,
      confidenceLevel: 0.1,
      scorerVersion: "v1",
      snapshotSchemaVersion: 2,
    },
    {
      testId: "t2",
      sessionId: "s1",
      variantId: "v2",
      variantType: "prompt_template",
      variantConfig: {},
      controlScore: 50,
      variantScore: 60,
      scoreDiff: 10,
      winner: "variant",
      isSignificant: true,
      confidenceLevel: 0.85,
      scorerVersion: "v1",
      snapshotSchemaVersion: 2,
    },
  ];

  const evaluator = new ReplayABEvaluator();
  const significant = evaluator.getSignificantWinners(results);

  assert.equal(significant.length, 1);
  assert.equal(significant[0].variantId, "v2");
});

test("ReplayABEvaluator scores sessions based on feedback", async () => {
  const evaluator = new ReplayABEvaluator();
  const snapshot: SessionSnapshot = {
    schemaVersion: 2,
    id: "session-1",
    tenantId: "tenant-1",
    sessionType: "agent-session",
    systemPrompt: "You are helpful",
    turns: [
      {
        turn: 1,
        input: "Test",
        output: "Response",
        agentsInvolved: ["agent1"],
        skillsUsed: ["skill1"],
        toolsUsed: [],
        duration: 100,
      },
    ],
    toolExecutions: [
      { tool: "test", args: {}, status: "success" },
      { tool: "test2", args: {}, status: "failure" },
    ],
    feedback: {
      score: 0.8,
      scoreAdjustment: 5,
    },
    createdAt: new Date(),
    status: "completed",
  };

  // Score with feedback should be different from baseline
  const result = await evaluator.runVariant(
    snapshot,
    {},
    "test",
    "prompt_template",
  );

  assert.ok(result.controlScore > 50); // Should be elevated due to feedback
});

test("ReplayABEvaluator runs multiple variants", async () => {
  const evaluator = new ReplayABEvaluator();
  const snapshot: SessionSnapshot = {
    schemaVersion: 2,
    id: "session-1",
    tenantId: "tenant-1",
    sessionType: "agent-session",
    systemPrompt: "You are helpful",
    turns: [],
    toolExecutions: [],
    createdAt: new Date(),
    status: "completed",
  };

  const variants = [
    {
      id: "v1",
      type: "prompt_template" as const,
      config: {
        promptTemplate: { name: "v1", content: "Template 1" },
      },
    },
    {
      id: "v2",
      type: "prompt_template" as const,
      config: {
        promptTemplate: { name: "v2", content: "Template 2" },
      },
    },
  ];

  const results = await evaluator.runMultipleVariants(snapshot, variants);

  assert.equal(results.length, 2);
  assert.ok(results.every((r: ABTestResult) => r.scorerVersion === "v1"));
});

test("snapshot migrator upgrades legacy snapshots to schema version 2", () => {
  const migrated = migrateSessionSnapshot({
    id: "session-legacy",
    tenantId: "tenant-1",
    sessionType: "agent-session",
    systemPrompt: "Legacy prompt",
    createdAt: new Date(),
    status: "completed"
  });

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, "session-legacy");
});

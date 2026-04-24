/**
 * Core Modules Unit Tests
 * 
 * test: node --test tests/core-modules.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

// Resource Selector Tests
import {
  scoreCandidate,
  selectResources,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_SCORING_CONFIG_BY_TYPE,
  getScoringConfigForType,
  selectResourcesByType,
  type ResourceCandidate
} from "../mcp/core/resource/resource-selector.js";

// Resource Gap Detector Tests
import {
  detectGap,
  createGapEvent,
  detectGapsForTopic
} from "../mcp/core/resource/resource-gap-detector.js";

// Resource Suggester Tests
import {
  suggestResource,
  suggestResourcesForGaps
} from "../mcp/core/resource/resource-suggester.js";

// Query Intent Classifier Tests
import {
  classifyQueryIntent,
  applyIntentScoringOverride,
  getScoringConfigForQuery,
  type QueryIntent
} from "../mcp/core/resource/query-intent-classifier.js";

// Cascading Delete Tests
import {
  detectCascadeImpact,
  evaluateCascadeDeletion,
  renderCascadeImpactMarkdown
} from "../mcp/core/resource/cascading-delete.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

// Trace Phase Decomposition Tests (TASK-038)
import {
  startTrace,
  endTrace,
  failTrace,
  startPhase,
  endPhase,
  withPhase,
  findTrace,
  configureTraceStorageForTest,
  clearTraceStorageForTest
} from "../mcp/core/trace/trace-context.js";

// Usage Pattern Detection Tests (TASK-039)
import {
  detectUsagePattern,
  shouldDeferCleanup
} from "../mcp/core/resource/usage-pattern.js";
import { suggestCleanupResources } from "../mcp/tools/suggest-cleanup-resources.js";

// Cleanup Scheduler Tests (TASK-041)
import {
  parseCronExpression,
  cronMatches,
  loadCleanupSchedules,
  saveCleanupSchedules,
  createCleanupSchedule,
  updateCleanupSchedule,
  deleteCleanupSchedule,
  setCleanupScheduleStatus,
  getDueSchedules
} from "../mcp/core/resource/cleanup-scheduler.js";

// Embedding Ranker Tests (TASK-042)
import {
  buildEmbedding,
  cosineSimilarity,
  embeddingSimilarity,
  rankBySemanticHybrid,
  computeHybridScoreMap
} from "../mcp/core/resource/embedding-ranker.js";

// Synergy Model Tests (TASK-043)
import {
  buildSynergyModel,
  getSynergyBonus,
  recommendCombo,
  extractSynergyRecordsFromTraces
} from "../mcp/core/resource/synergy-model.js";

// Observability Dashboard Tests (TASK-044)
import { buildObservabilityDashboard } from "../mcp/core/observability/dashboard.js";

// Model Registry Tests (TASK-045)
import {
  createModelRegistry,
  registerModelVersion,
  setShadowVersion,
  predictWithShadows,
  recordOutcome,
  evaluatePromotion,
  promoteShadow,
  rollback,
  toSnapshot,
  DEFAULT_PROMOTION_POLICY
} from "../mcp/core/learning/model-registry.js";

// Prompt Cache Persistence Tests (TASK-046)
import {
  loadPromptCacheFromDisk,
  appendPromptCacheEntry,
  clearPromptCacheFile,
  rewritePromptCacheFile
} from "../mcp/core/context/prompt-cache-persistence.js";

// RL Feedback / Bandit Tests (TASK-047)
import {
  createBanditState,
  ensureArm,
  recordFeedback,
  recordFeedbacks,
  selectArms,
  toBanditSnapshot,
  fromBanditSnapshot,
  tracesToFeedbacks
} from "../mcp/core/learning/rl-feedback.js";

// Quality Checker Tests
import {
  checkSkillQuality,
  checkToolQuality,
  checkPresetQuality
} from "../mcp/core/quality/quality-checker.js";

// Deduplication Tests
import {
  calculateSimilarity,
  checkForDuplicates,
  generateUniqueName
} from "../mcp/core/quality/deduplication.js";

// Governance Manager Tests
import {
  calculateResourceScore,
  assessRiskLevel,
  isOverCapacity
} from "../mcp/core/governance/governance-manager.js";
import { registerServerTools } from "../mcp/tool-registry.js";
import { startMcpTransport } from "../mcp/transport.js";
import { runWithLifecycle } from "../mcp/lifecycle.js";

// ============================================================
// Resource Selector Tests
// ============================================================

test("Resource Selector - Basic Scoring", () => {
  const candidate: ResourceCandidate = {
    name: "apex-testing",
    description: "Testing Apex code",
    tags: ["apex", "testing", "unit-test"],
    usage: 5,
    bugSignals: 1
  };

  const score = scoreCandidate(candidate, "apex test");
  assert.ok(score > 0, "Score should be positive for matching query");
});

test("Resource Selector - Select Resources", () => {
  const candidates: ResourceCandidate[] = [
    {
      name: "skill-1",
      description: "First skill",
      usage: 10,
      bugSignals: 0
    },
    {
      name: "skill-2",
      description: "Second skill",
      usage: 5,
      bugSignals: 2
    },
    {
      name: "skill-3",
      description: "Third skill",
      usage: 0,
      bugSignals: 0,
      disabled: true
    }
  ];

  const result = selectResources(candidates, "skill", 2);
  assert.equal(result.selected.length, 2, "Should select top 2 resources");
  assert.equal(result.selected[0].name, "skill-1", "skill-1 should be first");
});

test("Resource Selector - Gap Detection", () => {
  const candidates: ResourceCandidate[] = [
    {
      name: "low-score-skill",
      description: "x",
      usage: 0,
      bugSignals: 5
    }
  ];

  const result = selectResources(candidates, "unrelated-query", 1);
  assert.ok(result.isGap, "Should detect gap for low score");
});

// ============================================================
// Resource Gap Detector Tests
// ============================================================

test("Resource Gap Detector - Detect High Gap", () => {
  const result = detectGap("skills", "test-topic", 2, 5);
  assert.ok(result.detected, "Should detect gap");
  assert.equal(result.gapSeverity, "high", "Should be high severity");
});

test("Resource Gap Detector - No Gap", () => {
  const result = detectGap("tools", "test-topic", 8, 5);
  assert.ok(!result.detected, "Should not detect gap");
  assert.equal(result.gapSeverity, "none", "Should be no gap");
});

test("Resource Gap Detector - Create Event", () => {
  const gap = detectGap("presets", "test-topic", 3, 5);
  const event = createGapEvent(gap);
  assert.ok(event, "Should create event for detected gap");
  assert.equal(event!.event, "resource_gap_detected");
});

// ============================================================
// Resource Suggester Tests
// ============================================================

test("Resource Suggester - Generate Suggestion", () => {
  const gap = detectGap("skills", "testing-framework", 2, 5);
  const suggestion = suggestResource(gap);
  
  assert.equal(suggestion.action, "create", "Should suggest creation");
  assert.equal(suggestion.resourceType, "skills", "Should be skills type");
  assert.ok(suggestion.name, "Should have generated name");
});

// ============================================================
// Quality Checker Tests
// ============================================================

test("Quality Checker - Skill Quality Pass", () => {
  const result = checkSkillQuality({
    name: "good-skill",
    tags: ["apex", "testing"],
    summary: "This is a comprehensive skill definition"
  });

  assert.ok(result.pass, "Should pass quality check");
  assert.ok(result.score >= 70, "Should have decent score");
});

test("Quality Checker - Tool Quality Fail", () => {
  const result = checkToolQuality({
    name: "t",
    description: "x"
  });

  assert.ok(!result.pass, "Should fail quality check");
});

test("Quality Checker - Preset Quality", () => {
  const result = checkPresetQuality({
    name: "test-preset",
    description: "Test preset description",
    agents: ["agent-1", "agent-2"]
  });

  assert.ok(result.pass, "Should pass preset quality check");
});

// ============================================================
// Deduplication Tests
// ============================================================

test("Deduplication - Exact Similarity", () => {
  const resource1 = { name: "test-skill", description: "Test skill" };
  const resource2 = { name: "test-skill", description: "Test skill" };

  const similarity = calculateSimilarity(resource1, resource2);
  assert.equal(similarity, 1.0, "Exact match should have similarity of 1.0");
});

test("Deduplication - Duplicate Detection", () => {
  const newResource = { name: "skill-1", description: "First skill" };
  const existing = [
    { name: "skill-1", description: "First skill" },
    { name: "skill-2", description: "Second skill" }
  ];

  const result = checkForDuplicates(newResource, existing, 0.8);
  assert.ok(result.isDuplicate, "Should detect duplicate");
});

test("Deduplication - Generate Unique Name", () => {
  const existing = ["resource-1", "resource-2"];
  const name = generateUniqueName("resource", existing);
  
  assert.ok(!existing.includes(name), "Generated name should be unique");
});

// ============================================================
// Governance Manager Tests
// ============================================================

test("Governance Manager - Score Calculation", () => {
  const score = calculateResourceScore(10, 2);
  assert.equal(score, 4, "Score should be usage - (bugSignals * 3)");
});

test("Governance Manager - Risk Assessment High", () => {
  const risk = assessRiskLevel(0, 6); // bugSignals > 5 → high
  assert.equal(risk, "high", "Should be high risk");
});

test("Governance Manager - Risk Assessment Low", () => {
  const risk = assessRiskLevel(10, 0); // score > 2, bugSignals <= 2 → low
  assert.equal(risk, "low", "Should be low risk");
});

test("Governance Manager - Capacity Check", () => {
  const isOver = isOverCapacity("skills", 35, {
    maxCounts: { skills: 30, tools: 40, presets: 20 },
    thresholds: { minUsageToKeep: 2, bugSignalToFlag: 2 },
    resourceLimits: { creationsPerDay: 5, deletionsPerDay: 3 }
  });

  assert.ok(isOver, "Should be over capacity");
});

test("Server Split Modules - Exported entry points are callable", () => {
  assert.equal(typeof registerServerTools, "function");
  assert.equal(typeof startMcpTransport, "function");
  assert.equal(typeof runWithLifecycle, "function");
});

test("Resource Selector - per-resourceType default scoring configs differ", () => {
  assert.notDeepEqual(
    DEFAULT_SCORING_CONFIG_BY_TYPE.skills,
    DEFAULT_SCORING_CONFIG_BY_TYPE.tools,
    "skills and tools should have differentiated defaults"
  );
  assert.notDeepEqual(
    DEFAULT_SCORING_CONFIG_BY_TYPE.tools,
    DEFAULT_SCORING_CONFIG_BY_TYPE.presets,
    "tools and presets should have differentiated defaults"
  );

  const toolsConfig = getScoringConfigForType("tools");
  assert.ok(toolsConfig.bugPenaltyWeight > DEFAULT_SCORING_CONFIG.bugPenaltyWeight,
    "tools should penalize bugs more strongly than baseline");

  const presetsConfig = getScoringConfigForType("presets");
  assert.ok(presetsConfig.exactNameMatchWeight > DEFAULT_SCORING_CONFIG.exactNameMatchWeight,
    "presets should reward exact name matches more strongly than baseline");
});

test("Resource Selector - selectResourcesByType uses type-specific config when omitted", () => {
  const candidate: ResourceCandidate = {
    name: "release-readiness",
    description: "release readiness checklist preset",
    tags: ["release", "checklist"],
    usage: 5,
    bugSignals: 0
  };
  const result = selectResourcesByType("presets", [candidate], "release-readiness", 1);
  assert.equal(result.threshold, DEFAULT_SCORING_CONFIG_BY_TYPE.presets.gapThreshold,
    "threshold should follow preset config when no override is provided");
  assert.ok(result.detail[0].score > 0, "matching candidate should be selected");
});

test("Query Intent Classifier - achieves >=80% accuracy on labeled dataset", () => {
  const dataset: Array<{ query: string; expected: QueryIntent }> = [
    // design (5)
    { query: "新機能のアーキテクチャを設計したい", expected: "design" },
    { query: "design the data model for accounts", expected: "design" },
    { query: "ER図とブループリントを作る", expected: "design" },
    { query: "service architecture diagram", expected: "design" },
    { query: "object schema design", expected: "design" },
    // implement (5)
    { query: "Apex トリガーを実装する", expected: "implement" },
    { query: "implement a new LWC component", expected: "implement" },
    { query: "build the feature scaffold", expected: "implement" },
    { query: "新規エンドポイントを作成", expected: "implement" },
    { query: "add validation logic", expected: "implement" },
    // debug (5)
    { query: "本番でエラーが発生したので原因調査", expected: "debug" },
    { query: "fix the failing test stacktrace", expected: "debug" },
    { query: "バグの再現手順を整理する", expected: "debug" },
    { query: "exception thrown on save", expected: "debug" },
    { query: "broken integration to investigate", expected: "debug" },
    // optimize (5)
    { query: "クエリのパフォーマンス最適化", expected: "optimize" },
    { query: "reduce latency in flow", expected: "optimize" },
    { query: "ボトルネック解消の改善案", expected: "optimize" },
    { query: "improve throughput of batch", expected: "optimize" },
    { query: "tune apex performance", expected: "optimize" },
    // review (5)
    { query: "Apex コードのレビュー依頼", expected: "review" },
    { query: "audit the permission set", expected: "review" },
    { query: "セキュリティ監査チェック", expected: "review" },
    { query: "validate the deployment manifest", expected: "review" },
    { query: "code review for the new feature", expected: "review" },
    // document (5)
    { query: "READMEを更新したい", expected: "document" },
    { query: "write user guide for the integration", expected: "document" },
    { query: "API ドキュメントを整備", expected: "document" },
    { query: "spec for the new flow", expected: "document" },
    { query: "manual for admins", expected: "document" },
    // deploy (5)
    { query: "本番リリース準備", expected: "deploy" },
    { query: "deploy to sandbox before go-live", expected: "deploy" },
    { query: "デプロイ手順の確認", expected: "deploy" },
    { query: "release rollout plan", expected: "deploy" },
    { query: "ship to production", expected: "deploy" }
  ];

  let correct = 0;
  for (const sample of dataset) {
    const result = classifyQueryIntent(sample.query);
    if (result.intent === sample.expected) {
      correct += 1;
    }
  }
  const accuracy = correct / dataset.length;
  assert.ok(
    accuracy >= 0.8,
    `intent classification accuracy ${accuracy.toFixed(2)} should be >= 0.80 (correct=${correct}/${dataset.length})`
  );
});

test("Query Intent Classifier - returns unknown for non-matching queries", () => {
  const result = classifyQueryIntent("hello world");
  assert.equal(result.intent, "unknown");
  assert.equal(result.confidence, 0);
});

test("Query Intent Classifier - applies intent-specific scoring overrides", () => {
  const debugConfig = applyIntentScoringOverride(DEFAULT_SCORING_CONFIG, "debug");
  assert.ok(debugConfig.bugPenaltyWeight > DEFAULT_SCORING_CONFIG.bugPenaltyWeight,
    "debug intent should strengthen bug penalty");
  assert.ok(debugConfig.recencyBonusWeight < DEFAULT_SCORING_CONFIG.recencyBonusWeight,
    "debug intent should weaken recency bonus");

  const optimizeConfig = applyIntentScoringOverride(DEFAULT_SCORING_CONFIG, "optimize");
  assert.ok(optimizeConfig.usageWeight > DEFAULT_SCORING_CONFIG.usageWeight,
    "optimize intent should boost usage weight");

  const unknownConfig = applyIntentScoringOverride(DEFAULT_SCORING_CONFIG, "unknown");
  assert.deepEqual(unknownConfig, DEFAULT_SCORING_CONFIG,
    "unknown intent should not modify config");
});

test("Query Intent Classifier - getScoringConfigForQuery returns intent + adjusted config", () => {
  const { intent, config } = getScoringConfigForQuery("本番デプロイのリリース計画");
  assert.equal(intent.intent, "deploy");
  assert.ok(config.bugPenaltyWeight > DEFAULT_SCORING_CONFIG.bugPenaltyWeight);
});

test("Cascading Delete - detects downstream presets that include the skill", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "cascade-skill-"));
  const presetsDir = pathJoin(root, "presets");
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(
    pathJoin(presetsDir, "preset-a.json"),
    JSON.stringify({ name: "preset-a", agents: ["architect"], skills: ["apex/best-practices"] }),
    "utf-8"
  );
  writeFileSync(
    pathJoin(presetsDir, "preset-b.json"),
    JSON.stringify({ name: "preset-b", agents: ["qa"], skills: ["lwc/testing"] }),
    "utf-8"
  );
  try {
    const downstream = await detectCascadeImpact({
      resourceType: "skills",
      name: "apex/best-practices",
      presetsDir
    });
    assert.equal(downstream.length, 1);
    assert.equal(downstream[0].name, "preset-a");
    assert.match(downstream[0].reason, /preset "preset-a" includes skill/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Cascading Delete - block mode prevents deletion when downstream exists", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "cascade-block-"));
  const presetsDir = pathJoin(root, "presets");
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(
    pathJoin(presetsDir, "preset-x.json"),
    JSON.stringify({ name: "preset-x", agents: ["a"], skills: ["target-skill"] }),
    "utf-8"
  );
  try {
    const blockResult = await evaluateCascadeDeletion({
      resourceType: "skills",
      name: "target-skill",
      presetsDir,
      mode: "block"
    });
    assert.equal(blockResult.blocked, true);
    assert.equal(blockResult.downstream.length, 1);
    assert.match(blockResult.message, /delete blocked/);

    const promptResult = await evaluateCascadeDeletion({
      resourceType: "skills",
      name: "target-skill",
      presetsDir,
      mode: "prompt"
    });
    assert.equal(promptResult.blocked, false);
    assert.match(promptResult.message, /WARNING/);

    const forceResult = await evaluateCascadeDeletion({
      resourceType: "skills",
      name: "target-skill",
      presetsDir,
      mode: "force"
    });
    assert.equal(forceResult.blocked, false);
    assert.match(forceResult.message, /forced/);

    const md = renderCascadeImpactMarkdown(blockResult);
    assert.match(md, /# Cascade Impact Report/);
    assert.match(md, /preset-x/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Cascading Delete - returns no impact when target has no dependents", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "cascade-empty-"));
  const presetsDir = pathJoin(root, "presets");
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(
    pathJoin(presetsDir, "preset-other.json"),
    JSON.stringify({ name: "preset-other", agents: ["a"], skills: ["other"] }),
    "utf-8"
  );
  try {
    const result = await evaluateCascadeDeletion({
      resourceType: "skills",
      name: "unused-skill",
      presetsDir,
      mode: "block"
    });
    assert.equal(result.blocked, false);
    assert.equal(result.downstream.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Trace Phase Decomposition - records phase durations and survives endTrace", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "trace-phase-"));
  const traceFile = pathJoin(root, "trace-log.jsonl");
  configureTraceStorageForTest(traceFile);
  try {
    const traceId = startTrace("phase_demo_tool");
    startPhase(traceId, "input");
    await new Promise((r) => setTimeout(r, 5));
    endPhase(traceId, "input");

    await withPhase(traceId, "plan", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    startPhase(traceId, "execute");
    await new Promise((r) => setTimeout(r, 5));
    // intentionally do not call endPhase; endTrace should close it
    endTrace(traceId);

    const finished = findTrace(traceId);
    assert.ok(finished, "trace should be findable");
    assert.ok(Array.isArray(finished?.phases), "phases array should be set");
    const phaseNames = (finished?.phases ?? []).map((p) => p.name);
    assert.deepEqual(phaseNames, ["input", "plan", "execute"]);
    for (const phase of finished?.phases ?? []) {
      assert.equal(phase.status, "success", `phase ${phase.name} should be success`);
      assert.ok(typeof phase.durationMs === "number" && phase.durationMs >= 0,
        `phase ${phase.name} should have non-negative duration`);
    }
  } finally {
    clearTraceStorageForTest();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Trace Phase Decomposition - failTrace marks running phase as error", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "trace-phase-fail-"));
  const traceFile = pathJoin(root, "trace-log.jsonl");
  configureTraceStorageForTest(traceFile);
  try {
    const traceId = startTrace("phase_fail_tool");
    startPhase(traceId, "execute");
    failTrace(traceId, new Error("boom"));

    const finished = findTrace(traceId);
    assert.equal(finished?.status, "error");
    assert.equal(finished?.phases?.[0]?.status, "error");
    assert.equal(finished?.phases?.[0]?.errorMessage, "boom");
  } finally {
    clearTraceStorageForTest();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Usage Pattern - dormant when no usage recorded", () => {
  const result = detectUsagePattern({
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    usageCount: 0,
    now: new Date("2026-04-01T00:00:00.000Z")
  });
  assert.equal(result.pattern, "dormant");
  assert.equal(shouldDeferCleanup("dormant"), false);
});

test("Usage Pattern - daily when high frequency and recent", () => {
  const result = detectUsagePattern({
    firstSeenAt: "2026-03-01T00:00:00.000Z",
    lastUsedAt: "2026-04-01T00:00:00.000Z",
    usageCount: 31,
    now: new Date("2026-04-02T00:00:00.000Z")
  });
  assert.equal(result.pattern, "daily");
  assert.equal(shouldDeferCleanup("daily"), true);
});

test("Usage Pattern - weekly when moderate frequency", () => {
  const result = detectUsagePattern({
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-03-25T00:00:00.000Z",
    usageCount: 12,
    now: new Date("2026-04-01T00:00:00.000Z")
  });
  assert.equal(result.pattern, "weekly");
});

test("Usage Pattern - burst when many uses but recently inactive", () => {
  const result = detectUsagePattern({
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-02-01T00:00:00.000Z",
    usageCount: 20,
    now: new Date("2026-04-01T00:00:00.000Z")
  });
  assert.equal(result.pattern, "burst");
  assert.equal(shouldDeferCleanup("burst"), true);
});

test("suggestCleanupResources annotates candidates with usage pattern and softens burst confidence", () => {
  const now = new Date("2026-04-01T00:00:00.000Z");
  const result = suggestCleanupResources({
    now,
    daysUnused: 30,
    limit: 10,
    catalogs: { skills: ["dormant-skill", "burst-skill"], presets: [], customTools: [] },
    usage: { skills: { "dormant-skill": 0, "burst-skill": 20 }, tools: {}, presets: {} },
    bugSignals: { skills: {}, tools: {}, presets: {} },
    activity: {
      skills: {
        "dormant-skill": { firstSeenAt: "2026-01-01T00:00:00.000Z" },
        "burst-skill": {
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: "2026-02-15T00:00:00.000Z"
        }
      },
      tools: {},
      presets: {}
    }
  });

  const dormant = result.candidates.find((c) => c.name === "dormant-skill");
  assert.ok(dormant, "dormant candidate must be present");
  assert.equal(dormant?.usagePattern, "dormant");
  assert.equal(dormant?.confidence, "high");

  const burst = result.candidates.find((c) => c.name === "burst-skill");
  assert.ok(burst, "burst candidate must be present");
  assert.equal(burst?.usagePattern, "burst");
  // burst pattern softens confidence
  assert.notEqual(burst?.confidence, "high");
});

// ============================================================================
// Cleanup Scheduler Tests (TASK-041)
// ============================================================================

test("Cleanup Scheduler - parseCronExpression accepts valid expressions", () => {
  assert.ok(parseCronExpression("0 9 * * 1-5"));
  assert.ok(parseCronExpression("*/15 * * * *"));
  assert.ok(parseCronExpression("0 0,12 1 * *"));
  assert.ok(parseCronExpression("* * * * *"));
});

test("Cleanup Scheduler - parseCronExpression rejects invalid expressions", () => {
  assert.equal(parseCronExpression("not a cron"), null);
  assert.equal(parseCronExpression("60 * * * *"), null); // minute > 59
  assert.equal(parseCronExpression("* 25 * * *"), null); // hour > 23
  assert.equal(parseCronExpression("* * * *"), null); // too few fields
  assert.equal(parseCronExpression("5-2 * * * *"), null); // bad range
});

test("Cleanup Scheduler - cronMatches with specific Date", () => {
  // 2025-01-06 (Monday) at 09:00
  const monday0900 = new Date(2025, 0, 6, 9, 0, 0);
  assert.equal(cronMatches("0 9 * * 1-5", monday0900), true);
  assert.equal(cronMatches("0 10 * * 1-5", monday0900), false);
  // Sunday
  const sunday0900 = new Date(2025, 0, 5, 9, 0, 0);
  assert.equal(cronMatches("0 9 * * 1-5", sunday0900), false);
  // step
  const at15 = new Date(2025, 0, 6, 9, 15, 0);
  assert.equal(cronMatches("*/15 * * * *", at15), true);
  const at16 = new Date(2025, 0, 6, 9, 16, 0);
  assert.equal(cronMatches("*/15 * * * *", at16), false);
});

test("Cleanup Scheduler - createCleanupSchedule validates cron", () => {
  const empty = { version: 1, updatedAt: new Date().toISOString(), schedules: [] };
  const ok = createCleanupSchedule(empty, { name: "weekday-9am", cron: "0 9 * * 1-5" });
  assert.equal(ok.schedule.name, "weekday-9am");
  assert.equal(ok.schedule.action, "dry-run");
  assert.equal(ok.schedule.status, "active");
  assert.ok(ok.schedule.id);
  assert.equal(ok.file.schedules.length, 1);

  assert.throws(
    () => createCleanupSchedule(empty, { name: "bad", cron: "not cron" }),
    /invalid cron/
  );
});

test("Cleanup Scheduler - update / delete / setStatus", () => {
  let file = { version: 1, updatedAt: new Date().toISOString(), schedules: [] as any[] } as any;
  const created = createCleanupSchedule(file, { name: "n1", cron: "0 9 * * *" });
  file = created.file;
  const id = created.schedule.id;

  const updated = updateCleanupSchedule(file, id, { name: "n1-renamed", limit: 50 });
  assert.equal(updated.schedule.name, "n1-renamed");
  assert.equal(updated.schedule.limit, 50);
  file = updated.file;

  const paused = setCleanupScheduleStatus(file, id, "paused");
  assert.equal(paused.schedule.status, "paused");
  file = paused.file;

  const del = deleteCleanupSchedule(file, id);
  assert.equal(del.deleted, true);
  assert.equal(del.file.schedules.length, 0);

  // delete non-existent
  const noop = deleteCleanupSchedule(del.file, "missing");
  assert.equal(noop.deleted, false);

  // update non-existent
  assert.throws(() => updateCleanupSchedule(del.file, "missing", {}), /schedule not found/);
});

test("Cleanup Scheduler - getDueSchedules filters by active + cron", () => {
  let file = { version: 1, updatedAt: new Date().toISOString(), schedules: [] as any[] } as any;
  file = createCleanupSchedule(file, { name: "a", cron: "0 9 * * 1-5" }).file;
  file = createCleanupSchedule(file, { name: "b", cron: "0 10 * * *" }).file;
  // pause "a"
  file = setCleanupScheduleStatus(file, file.schedules[0].id, "paused").file;

  const monday0900 = new Date(2025, 0, 6, 9, 0, 0);
  const due = getDueSchedules(file, monday0900);
  assert.equal(due.length, 0); // a paused, b not matching

  const at1000 = new Date(2025, 0, 6, 10, 0, 0);
  const due2 = getDueSchedules(file, at1000);
  assert.equal(due2.length, 1);
  assert.equal(due2[0].name, "b");
});

test("Cleanup Scheduler - load/save round-trip", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "cleanup-sched-"));
  const filePath = pathJoin(root, "schedules.json");
  try {
    const empty = await loadCleanupSchedules(filePath);
    assert.equal(empty.schedules.length, 0);

    const created = createCleanupSchedule(empty, { name: "rt", cron: "0 9 * * *" });
    await saveCleanupSchedules(filePath, created.file);

    const reloaded = await loadCleanupSchedules(filePath);
    assert.equal(reloaded.schedules.length, 1);
    assert.equal(reloaded.schedules[0].name, "rt");
    assert.equal(reloaded.schedules[0].id, created.schedule.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ============================================================================
// Embedding Ranker Tests (TASK-042)
// ============================================================================

test("Embedding Ranker - identical text yields cosine ~1", () => {
  const a = buildEmbedding("apex trigger optimization");
  const b = buildEmbedding("apex trigger optimization");
  assert.ok(cosineSimilarity(a, b) > 0.999);
});

test("Embedding Ranker - empty text yields zero similarity", () => {
  assert.equal(embeddingSimilarity("", "anything"), 0);
  assert.equal(embeddingSimilarity("query", ""), 0);
});

test("Embedding Ranker - similar terms score higher than unrelated", () => {
  const sim1 = embeddingSimilarity("apex trigger", "apex triggers best practice");
  const sim2 = embeddingSimilarity("apex trigger", "lwc component testing");
  assert.ok(sim1 > sim2, `expected related > unrelated (${sim1} vs ${sim2})`);
});

test("Embedding Ranker - rankBySemanticHybrid orders by hybrid score", () => {
  const ranked = rankBySemanticHybrid(
    "apex trigger optimization",
    [
      { name: "skill-a", text: "apex trigger optimization tips", tokenScore: 5 },
      { name: "skill-b", text: "lwc reactive component", tokenScore: 1 },
      { name: "skill-c", text: "apex bulk patterns", tokenScore: 3 }
    ],
    { alpha: 0.5 }
  );
  assert.equal(ranked[0].name, "skill-a");
  assert.ok(ranked[0].hybridScore > ranked[ranked.length - 1].hybridScore);
});

test("Embedding Ranker - alpha=1 falls back to token-only ranking", () => {
  const ranked = rankBySemanticHybrid(
    "abc",
    [
      { name: "low-token", text: "abc xyz match", tokenScore: 1 },
      { name: "high-token", text: "completely unrelated qqq", tokenScore: 9 }
    ],
    { alpha: 1.0 }
  );
  // alpha=1 → embedding は無視され token のみで決まる
  assert.equal(ranked[0].name, "high-token");
});

test("Embedding Ranker - alpha=0 falls back to embedding-only ranking", () => {
  const ranked = rankBySemanticHybrid(
    "apex trigger",
    [
      { name: "high-token", text: "completely unrelated", tokenScore: 9 },
      { name: "low-token", text: "apex trigger optimization", tokenScore: 0 }
    ],
    { alpha: 0 }
  );
  assert.equal(ranked[0].name, "low-token");
});

test("Embedding Ranker - computeHybridScoreMap returns map by name", () => {
  const map = computeHybridScoreMap("salesforce", [
    { name: "x", text: "salesforce flow design" },
    { name: "y", text: "go programming language" }
  ]);
  assert.ok(map.has("x"));
  assert.ok(map.has("y"));
  assert.ok((map.get("x")?.hybridScore ?? 0) > (map.get("y")?.hybridScore ?? 0));
});

test("Embedding Ranker - selectResources hybrid mode reranks by semantic similarity", () => {
  const candidates = [
    {
      name: "apex-trigger-best-practices",
      description: "apex trigger 設計のベストプラクティス",
      tags: ["apex", "trigger"],
      usage: 0,
      bugSignals: 0
    },
    {
      name: "lwc-reactive-properties",
      description: "lwc reactive properties 入門",
      tags: ["lwc"],
      usage: 0,
      bugSignals: 0
    }
  ];

  // Default (off) と hybrid 両方で apex 関連が上位に来る
  const off = selectResources(candidates, "apex trigger", 2);
  assert.equal(off.selected[0].name, "apex-trigger-best-practices");

  const hybrid = selectResources(candidates, "apex trigger", 2, {
    ...DEFAULT_SCORING_CONFIG,
    embeddingMode: "hybrid",
    embeddingAlpha: 0.5
  });
  assert.equal(hybrid.selected[0].name, "apex-trigger-best-practices");
  // hybrid score は 0..1 にスケールされている
  assert.ok(hybrid.selected[0].score <= 1.0);
});

// ============================================================================
// Agent×Skill Synergy Model Tests (TASK-043)
// ============================================================================

test("Synergy Model - empty input returns empty model", () => {
  const model = buildSynergyModel([]);
  assert.equal(model.totalRecords, 0);
  assert.equal(model.pairs.size, 0);
  assert.equal(getSynergyBonus(model, "x", "y"), 0);
});

test("Synergy Model - aggregates pair counts and success rate", () => {
  const model = buildSynergyModel([
    { agent: "apex-developer", skill: "trigger-design", success: true },
    { agent: "apex-developer", skill: "trigger-design", success: true },
    { agent: "apex-developer", skill: "trigger-design", success: false },
    { agent: "lwc-developer", skill: "reactive-properties", success: true }
  ]);
  const apex = model.pairs.get("apex-developer::trigger-design");
  assert.ok(apex);
  assert.equal(apex?.count, 3);
  assert.equal(apex?.successCount, 2);
  // Laplace: (2+1)/(3+2) = 0.6
  assert.ok(Math.abs((apex?.successRate ?? 0) - 0.6) < 1e-9);
});

test("Synergy Model - higher count + success → higher synergy", () => {
  const model = buildSynergyModel([
    // Strong pair: 5 successes
    ...Array.from({ length: 5 }, () => ({ agent: "a", skill: "s1", success: true })),
    // Weak pair: 1 success
    { agent: "a", skill: "s2", success: true }
  ]);
  const strong = getSynergyBonus(model, "a", "s1");
  const weak = getSynergyBonus(model, "a", "s2");
  assert.ok(strong > weak);
  assert.equal(strong, 1.0); // normalized max
});

test("Synergy Model - recommendCombo returns top by synergy", () => {
  const model = buildSynergyModel([
    ...Array.from({ length: 4 }, () => ({ agent: "a1", skill: "s1", success: true })),
    ...Array.from({ length: 2 }, () => ({ agent: "a2", skill: "s2", success: true })),
    { agent: "a1", skill: "s2", success: false }
  ]);
  const combos = recommendCombo(model, {
    agents: ["a1", "a2"],
    skills: ["s1", "s2"],
    limit: 2
  });
  assert.equal(combos.length, 2);
  assert.equal(combos[0].agent, "a1");
  assert.equal(combos[0].skill, "s1");
});

test("Synergy Model - recommendCombo skips unseen pairs", () => {
  const model = buildSynergyModel([
    { agent: "a1", skill: "s1", success: true }
  ]);
  const combos = recommendCombo(model, {
    agents: ["a1", "unknown"],
    skills: ["s1", "unseen"],
    limit: 5
  });
  assert.equal(combos.length, 1);
  assert.equal(combos[0].agent, "a1");
});

test("Synergy Model - extractSynergyRecordsFromTraces normalizes traces", () => {
  const records = extractSynergyRecordsFromTraces([
    {
      status: "success",
      metadata: { agent: "apex-developer", skills: ["trigger-design", "bulk-patterns"] }
    },
    {
      status: "error",
      metadata: { agent: "lwc-developer", skills: ["reactive-properties"] }
    },
    { status: "running", metadata: { agent: "x", skills: ["y"] } }, // skipped
    { status: "success", metadata: { agent: "no-skills" } } // skipped
  ]);
  assert.equal(records.length, 3);
  assert.equal(records[0].agent, "apex-developer");
  assert.equal(records[0].success, true);
  assert.equal(records[2].success, false);
});

// ============================================================================
// Observability Dashboard Tests (TASK-044)
// ============================================================================

test("Observability Dashboard - empty input produces zero summary", () => {
  const r = buildObservabilityDashboard({ traces: [], events: [] });
  assert.equal(r.summary.traceCount, 0);
  assert.equal(r.summary.errorRate, 0);
  assert.ok(r.html.includes("Observability Dashboard"));
  assert.ok(r.markdown.startsWith("# Observability Dashboard"));
});

test("Observability Dashboard - aggregates error rate and top failing tools", () => {
  const r = buildObservabilityDashboard({
    traces: [
      { traceId: "t1", toolName: "tool-a", startedAt: "2026-04-24T09:00:00Z", endedAt: "2026-04-24T09:00:01Z", status: "error", errorMessage: "boom" },
      { traceId: "t2", toolName: "tool-a", startedAt: "2026-04-24T09:00:02Z", endedAt: "2026-04-24T09:00:03Z", status: "error", errorMessage: "boom" },
      { traceId: "t3", toolName: "tool-b", startedAt: "2026-04-24T09:00:04Z", endedAt: "2026-04-24T09:00:05Z", status: "success" },
      { traceId: "t4", toolName: "tool-c", startedAt: "2026-04-24T09:00:06Z", endedAt: "2026-04-24T09:00:07Z", status: "error", errorMessage: "x" }
    ],
    events: []
  });
  assert.equal(r.summary.traceCount, 4);
  assert.equal(r.summary.errorTraceCount, 3);
  assert.equal(r.summary.successTraceCount, 1);
  assert.ok(Math.abs(r.summary.errorRate - 0.75) < 1e-9);
  assert.equal(r.summary.topFailingTools[0].toolName, "tool-a");
  assert.equal(r.summary.topFailingTools[0].failures, 2);
});

test("Observability Dashboard - correlates events within window", () => {
  const r = buildObservabilityDashboard({
    traces: [
      {
        traceId: "t1",
        toolName: "tool-a",
        startedAt: "2026-04-24T09:00:00Z",
        endedAt: "2026-04-24T09:00:10.000Z",
        status: "error",
        errorMessage: "boom"
      }
    ],
    events: [
      { id: "e1", event: "tool_after_execute", timestamp: "2026-04-24T09:00:09.500Z" },
      { id: "e2", event: "tool_disabled", timestamp: "2026-04-24T09:00:11.000Z" },
      { id: "e3", event: "session_end", timestamp: "2026-04-24T10:00:00.000Z" }
    ],
    correlationWindowMs: 5000
  });
  assert.equal(r.correlations.length, 1);
  // e1 (within 500ms) と e2 (within 1s) は入る、e3 は窓外
  const ids = r.correlations[0].relatedEvents.map((e) => e.id);
  assert.deepEqual(ids.sort(), ["e1", "e2"]);
});

test("Observability Dashboard - includes governance flagged rows", () => {
  const r = buildObservabilityDashboard({
    traces: [],
    events: [],
    governanceFlagged: [
      { resourceType: "skills", name: "obsolete-skill", reason: "disabled" },
      { resourceType: "tools", name: "buggy-tool", reason: "bugSignals=7" }
    ]
  });
  assert.equal(r.summary.governanceFlaggedCount, 2);
  assert.ok(r.markdown.includes("obsolete-skill"));
  assert.ok(r.html.includes("buggy-tool"));
});

// ============================================================================
// Model Registry Tests (TASK-045)
// ============================================================================

test("Model Registry - register and predict with production only", () => {
  const reg = createModelRegistry();
  registerModelVersion<number, number>(reg, {
    name: "double",
    version: "v1",
    predict: (n) => n * 2
  });
  const r = predictWithShadows<number, number>(reg, "double", 5);
  assert.equal(r.production, 10);
  assert.equal(r.productionVersion, "v1");
  assert.deepEqual(r.shadowOutputs, {});
});

test("Model Registry - shadow runs alongside production", () => {
  const reg = createModelRegistry();
  registerModelVersion<number, number>(reg, { name: "m", version: "v1", predict: (n) => n + 1 });
  registerModelVersion<number, number>(reg, { name: "m", version: "v2", predict: (n) => n + 2 });
  setShadowVersion(reg, "m", "v2");

  const r = predictWithShadows<number, number>(reg, "m", 10);
  assert.equal(r.production, 11);
  assert.equal(r.shadowOutputs["v2"], 12);
});

test("Model Registry - duplicate version registration throws", () => {
  const reg = createModelRegistry();
  registerModelVersion(reg, { name: "m", version: "v1", predict: () => 0 });
  assert.throws(() => registerModelVersion(reg, { name: "m", version: "v1", predict: () => 0 }), /already registered/);
});

test("Model Registry - shadow throwing does not break production", () => {
  const reg = createModelRegistry();
  registerModelVersion<number, number>(reg, { name: "m", version: "v1", predict: (n) => n });
  registerModelVersion<number, number>(reg, {
    name: "m",
    version: "v2",
    predict: () => {
      throw new Error("shadow boom");
    }
  });
  setShadowVersion(reg, "m", "v2");
  const r = predictWithShadows<number, number>(reg, "m", 7);
  assert.equal(r.production, 7);
  assert.equal(r.shadowOutputs["v2"], undefined);
});

test("Model Registry - recordOutcome updates stats", () => {
  const reg = createModelRegistry();
  registerModelVersion(reg, { name: "m", version: "v1", predict: () => 0 });
  registerModelVersion(reg, { name: "m", version: "v2", predict: () => 0 });
  setShadowVersion(reg, "m", "v2");
  for (let i = 0; i < 8; i++) recordOutcome(reg, "m", "v2", "shadow");
  for (let i = 0; i < 2; i++) recordOutcome(reg, "m", "v2", "production");
  const stats = reg.get("m")!.evaluations.get("v2")!;
  assert.equal(stats.total, 10);
  assert.equal(stats.shadowWins, 8);
  assert.equal(stats.shadowWinRate, 0.8);
});

test("Model Registry - evaluatePromotion respects policy", () => {
  const reg = createModelRegistry();
  registerModelVersion(reg, { name: "m", version: "v1", predict: () => 0 });
  registerModelVersion(reg, { name: "m", version: "v2", predict: () => 0 });
  setShadowVersion(reg, "m", "v2");

  // Below minSamples
  for (let i = 0; i < 5; i++) recordOutcome(reg, "m", "v2", "shadow");
  const notReady = evaluatePromotion(reg, "m");
  assert.equal(notReady.ready, false);

  // Above minSamples with strong shadow win rate
  for (let i = 0; i < 30; i++) recordOutcome(reg, "m", "v2", "shadow");
  const ready = evaluatePromotion(reg, "m");
  assert.equal(ready.ready, true);
  assert.equal(ready.candidate, "v2");
});

test("Model Registry - promote and rollback", () => {
  const reg = createModelRegistry();
  registerModelVersion<number, number>(reg, { name: "m", version: "v1", predict: (n) => n });
  registerModelVersion<number, number>(reg, { name: "m", version: "v2", predict: (n) => n + 100 });
  setShadowVersion(reg, "m", "v2");

  const promoted = promoteShadow(reg, "m", "v2");
  assert.equal(promoted.previous, "v1");
  assert.equal(promoted.current, "v2");
  let r = predictWithShadows<number, number>(reg, "m", 5);
  assert.equal(r.production, 105);

  const rolled = rollback(reg, "m");
  assert.equal(rolled.from, "v2");
  assert.equal(rolled.to, "v1");
  r = predictWithShadows<number, number>(reg, "m", 5);
  assert.equal(r.production, 5);

  // No further rollback target
  assert.throws(() => rollback(reg, "m"), /no previous version/);
});

test("Model Registry - toSnapshot serializes structure", () => {
  const reg = createModelRegistry();
  registerModelVersion(reg, { name: "m", version: "v1", predict: () => 0 });
  registerModelVersion(reg, { name: "m", version: "v2", predict: () => 0 });
  setShadowVersion(reg, "m", "v2");
  const snap = toSnapshot(reg);
  assert.equal(snap.models.length, 1);
  assert.equal(snap.models[0].productionVersion, "v1");
  assert.deepEqual(snap.models[0].shadowVersions, ["v2"]);
  assert.ok(snap.models[0].versionList.includes("v2"));
});

test("Model Registry - DEFAULT_PROMOTION_POLICY is sane", () => {
  assert.ok(DEFAULT_PROMOTION_POLICY.minSamples >= 10);
  assert.ok(DEFAULT_PROMOTION_POLICY.minShadowWinRate > 0.5);
});

// ============================================================================
// Prompt Cache Persistence Tests (TASK-046)
// ============================================================================

test("Prompt Cache Persistence - missing file returns empty map", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  try {
    const map = loadPromptCacheFromDisk(pathJoin(root, "missing.jsonl"), { ttlMs: 60000 });
    assert.equal(map.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - append + load round trip", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    appendPromptCacheEntry(file, { key: "k1", prompt: "hello", createdAt: Date.now(), input: { topic: "t1" } });
    appendPromptCacheEntry(file, { key: "k2", prompt: "world", createdAt: Date.now(), input: { topic: "t2" } });

    const map = loadPromptCacheFromDisk<{ topic: string }>(file, { ttlMs: 60000 });
    assert.equal(map.size, 2);
    assert.equal(map.get("k1")?.prompt, "hello");
    assert.equal(map.get("k2")?.input.topic, "t2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - TTL filters expired entries on load", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    const now = 1_000_000_000_000;
    appendPromptCacheEntry(file, { key: "expired", prompt: "old", createdAt: now - 200_000, input: {} });
    appendPromptCacheEntry(file, { key: "fresh", prompt: "new", createdAt: now - 1000, input: {} });

    const map = loadPromptCacheFromDisk(file, { ttlMs: 60_000, now });
    assert.equal(map.size, 1);
    assert.ok(map.has("fresh"));
    assert.ok(!map.has("expired"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - duplicate key keeps latest", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    appendPromptCacheEntry(file, { key: "k", prompt: "v1", createdAt: Date.now(), input: { v: 1 } });
    appendPromptCacheEntry(file, { key: "k", prompt: "v2", createdAt: Date.now(), input: { v: 2 } });
    const map = loadPromptCacheFromDisk<{ v: number }>(file, { ttlMs: 60000 });
    assert.equal(map.size, 1);
    assert.equal(map.get("k")?.prompt, "v2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - corrupted lines are skipped", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    // 直接書き込み: 1 行目は破損, 2 行目は正常
    writeFileSync(
      file,
      "not json{}\n" + JSON.stringify({ key: "ok", prompt: "p", createdAt: Date.now(), input: {} }) + "\n",
      "utf-8"
    );
    const map = loadPromptCacheFromDisk(file, { ttlMs: 60000 });
    assert.equal(map.size, 1);
    assert.ok(map.has("ok"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - clear empties the file", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    appendPromptCacheEntry(file, { key: "k", prompt: "v", createdAt: Date.now(), input: {} });
    clearPromptCacheFile(file);
    const map = loadPromptCacheFromDisk(file, { ttlMs: 60000 });
    assert.equal(map.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Prompt Cache Persistence - rewrite compacts duplicates", () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "pcache-"));
  const file = pathJoin(root, "cache.jsonl");
  try {
    appendPromptCacheEntry(file, { key: "k", prompt: "v1", createdAt: Date.now(), input: { v: 1 } });
    appendPromptCacheEntry(file, { key: "k", prompt: "v2", createdAt: Date.now(), input: { v: 2 } });
    const map = loadPromptCacheFromDisk(file, { ttlMs: 60000 });
    rewritePromptCacheFile(file, map.values());
    const reloaded = loadPromptCacheFromDisk(file, { ttlMs: 60000 });
    assert.equal(reloaded.size, 1);
    // 行数も 1 行
    const text = readFileSync(file, "utf-8");
    assert.equal(text.trim().split(/\r?\n/).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ============================================================================
// RL Bandit Tests (TASK-047)
// ============================================================================

test("RL Bandit - ensureArm initializes Beta(1,1)", () => {
  const s = createBanditState();
  const arm = ensureArm(s, "x");
  assert.equal(arm.alpha, 1);
  assert.equal(arm.beta, 1);
});

test("RL Bandit - recordFeedback updates alpha/beta", () => {
  const s = createBanditState();
  recordFeedback(s, { name: "x", reward: true });
  recordFeedback(s, { name: "x", reward: true });
  recordFeedback(s, { name: "x", reward: false });
  const arm = s.arms.get("x")!;
  assert.equal(arm.alpha, 3); // 1 + 2 successes
  assert.equal(arm.beta, 2);  // 1 + 1 failure
});

test("RL Bandit - recordFeedback with weight scales updates", () => {
  const s = createBanditState();
  recordFeedback(s, { name: "x", reward: true, weight: 0.5 });
  recordFeedback(s, { name: "x", reward: false, weight: 0.25 });
  const arm = s.arms.get("x")!;
  assert.equal(arm.alpha, 1.5);
  assert.equal(arm.beta, 1.25);
});

test("RL Bandit - selectArms favors high-success arm in expectation", () => {
  const s = createBanditState();
  // strong arm: 50 successes
  recordFeedbacks(s, Array.from({ length: 50 }, () => ({ name: "good", reward: true })));
  // weak arm: 50 failures
  recordFeedbacks(s, Array.from({ length: 50 }, () => ({ name: "bad", reward: false })));

  // 決定的 RNG (各呼出で 0.5 を返す) → posterior mean に近い
  const rng = () => 0.5;
  let goodWins = 0;
  for (let i = 0; i < 30; i++) {
    const top = selectArms(s, ["good", "bad"], { rng, limit: 1 });
    if (top[0].name === "good") goodWins += 1;
  }
  // good arm のサンプルは ~1.0 付近、bad arm は ~0.0 付近で必ず勝つ
  assert.ok(goodWins >= 28, `expected good to dominate (${goodWins}/30)`);
});

test("RL Bandit - selectArms returns top-N sorted", () => {
  const s = createBanditState();
  recordFeedbacks(s, Array.from({ length: 30 }, () => ({ name: "a", reward: true })));
  recordFeedbacks(s, Array.from({ length: 20 }, () => ({ name: "b", reward: true })));
  recordFeedbacks(s, Array.from({ length: 30 }, () => ({ name: "b", reward: false })));
  recordFeedbacks(s, Array.from({ length: 30 }, () => ({ name: "c", reward: false })));

  const rng = () => 0.5;
  const top = selectArms(s, ["a", "b", "c"], { rng, limit: 3 });
  assert.equal(top.length, 3);
  // 単調減少
  assert.ok(top[0].sampledScore >= top[1].sampledScore);
  assert.ok(top[1].sampledScore >= top[2].sampledScore);
});

test("RL Bandit - forcedExplorationRate=1 picks coldest arm first", () => {
  const s = createBanditState();
  recordFeedbacks(s, Array.from({ length: 50 }, () => ({ name: "hot", reward: true })));
  ensureArm(s, "cold"); // alpha=1, beta=1

  const rng = () => 0.0; // < 1.0 → 強制探索発火
  const top = selectArms(s, ["hot", "cold"], { rng, forcedExplorationRate: 1.0, limit: 1 });
  assert.equal(top[0].name, "cold");
});

test("RL Bandit - selectArms returns empty for empty candidates", () => {
  const s = createBanditState();
  assert.deepEqual(selectArms(s, [], {}), []);
  assert.deepEqual(selectArms(s, null, {}), []);
});

test("RL Bandit - snapshot round trip preserves alpha/beta", () => {
  const s = createBanditState();
  recordFeedbacks(s, [
    { name: "x", reward: true },
    { name: "x", reward: false },
    { name: "y", reward: true }
  ]);
  const snap = toBanditSnapshot(s);
  const restored = fromBanditSnapshot(snap);
  const x = restored.arms.get("x")!;
  assert.equal(x.alpha, 2);
  assert.equal(x.beta, 2);
});

test("RL Bandit - tracesToFeedbacks normalizes trace status", () => {
  const fb = tracesToFeedbacks([
    { resourceName: "a", status: "success" },
    { resourceName: "a", status: "error" },
    { resourceName: "", status: "success" }, // skipped
    { resourceName: "b", status: "running" } // skipped
  ]);
  assert.equal(fb.length, 2);
  assert.equal(fb[0].reward, true);
  assert.equal(fb[1].reward, false);
});

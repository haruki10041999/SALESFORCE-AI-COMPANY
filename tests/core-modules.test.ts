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

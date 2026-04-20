/**
 * Handlers Unit Tests
 * 
 * test: node --test tests/handlers-modules.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

// Gap Handler Tests
import {
  handleResourceGapDetected,
  DEFAULT_HANDLER_CONFIG
} from "../mcp/handlers/resource/resource-gap.handler.js";

// Created Handler Tests
import {
  initializeCreatedResourceTracker,
  handleResourceCreated,
  generateCreationSummary,
  countCreationsInLastDay
} from "../mcp/handlers/resource/resource-created.handler.js";

// Deleted Handler Tests
import {
  initializeDeletedResourceTracker,
  recordResourceDeletion,
  getRecentlyDeletedResources,
  getDeletionCountByType
} from "../mcp/handlers/resource/resource-deleted.handler.js";

// Error Aggregate Handler Tests
import {
  initializeErrorAggregateTracker,
  recordToolError,
  detectErrorAggregations,
  generateErrorReport
} from "../mcp/handlers/governance/error-aggregate.handler.js";

// Quality Check Failed Handler Tests
import {
  initializeQualityCheckFailureTracker,
  recordQualityCheckFailure,
  detectFailurePatterns,
  generateFailureReport
} from "../mcp/handlers/governance/quality-check-failed.handler.js";

// Statistics Manager Tests
import {
  initializeHandlersStatistics,
  generateHandlersStatisticsSummary,
  exportStatisticsAsJson
} from "../mcp/handlers/statistics-manager.js";

// ============================================================
// Resource Created Handler Tests
// ============================================================

test("Resource Created Handler - Initialize Tracker", () => {
  const tracker = initializeCreatedResourceTracker();
  
  assert.equal(tracker.totalCreated, 0, "Initial total should be 0");
  assert.deepEqual(tracker.createdByType, { skills: 0, tools: 0, presets: 0 });
});

test("Resource Created Handler - Record Creation", () => {
  const tracker = initializeCreatedResourceTracker();
  
  const result = handleResourceCreated({
    resourceType: "skills",
    name: "test-skill",
    source: "apply_resource_actions"
  }, tracker);
  
  assert.equal(result.totalCreated, 1, "Should increment total");
  assert.equal(result.createdByType.skills, 1, "Should increment skills count");
  assert.equal(result.createdBySource["apply_resource_actions"], 1);
});

test("Resource Created Handler - Summary Generation", () => {
  const tracker = initializeCreatedResourceTracker();
  
  handleResourceCreated({ resourceType: "skills", name: "skill-1" }, tracker);
  handleResourceCreated({ resourceType: "tools", name: "tool-1" }, tracker);
  
  const summary = generateCreationSummary(tracker);
  assert.equal(summary.totalCreated, 2, "Summary should show 2 created");
});

test("Resource Created Handler - Count In Last Day", () => {
  const tracker = initializeCreatedResourceTracker();
  
  handleResourceCreated({ resourceType: "skills", name: "skill-1" }, tracker);
  handleResourceCreated({ resourceType: "skills", name: "skill-2" }, tracker);
  
  const count = countCreationsInLastDay(tracker, 24);
  assert.equal(count.total, 2, "Should count recent creations");
});

// ============================================================
// Resource Deleted Handler Tests
// ============================================================

test("Resource Deleted Handler - Initialize Tracker", () => {
  const tracker = initializeDeletedResourceTracker();
  
  assert.equal(tracker.deletedResources.length, 0);
  assert.deepEqual(tracker.deletedByType, { skills: 0, tools: 0, presets: 0 });
});

test("Resource Deleted Handler - Record Deletion", () => {
  const tracker = initializeDeletedResourceTracker();
  
  const result = recordResourceDeletion(tracker, "skills", "test-skill", "low usage");
  
  assert.equal(result.resourceType, "skills");
  assert.equal(result.name, "test-skill");
  assert.equal(tracker.deletedByType.skills, 1);
});

test("Resource Deleted Handler - Get Recent Deletions", () => {
  const tracker = initializeDeletedResourceTracker();
  
  recordResourceDeletion(tracker, "skills", "skill-1");
  recordResourceDeletion(tracker, "tools", "tool-1");
  
  const recent = getRecentlyDeletedResources(tracker, 2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].name, "tool-1", "Most recent should be first");
});

test("Resource Deleted Handler - Count By Type", () => {
  const tracker = initializeDeletedResourceTracker();
  
  recordResourceDeletion(tracker, "skills", "skill-1");
  recordResourceDeletion(tracker, "skills", "skill-2");
  
  const count = getDeletionCountByType(tracker, "skills");
  assert.equal(count, 2);
});

// ============================================================
// Error Aggregate Handler Tests
// ============================================================

test("Error Aggregate Handler - Initialize Tracker", () => {
  const tracker = initializeErrorAggregateTracker(10 * 60 * 1000, 3);
  
  assert.equal(tracker.toolErrors.size, 0);
  assert.equal(tracker.aggregateThreshold, 3);
});

test("Error Aggregate Handler - Record Error", () => {
  const tracker = initializeErrorAggregateTracker();
  
  const record = recordToolError(tracker, "test-tool", "Test error message");
  
  assert.equal(record.errorCount, 1);
  assert.equal(record.lastError, "Test error message");
});

test("Error Aggregate Handler - Detect Aggregations", () => {
  const tracker = initializeErrorAggregateTracker(10 * 60 * 1000, 2);
  
  recordToolError(tracker, "tool-1", "Error 1");
  recordToolError(tracker, "tool-1", "Error 2");
  recordToolError(tracker, "tool-1", "Error 3");
  
  const aggregations = detectErrorAggregations(tracker);
  assert.ok(aggregations.length > 0, "Should detect aggregation");
  assert.equal(aggregations[0].shouldDisable, true);
});

test("Error Aggregate Handler - Generate Report", () => {
  const tracker = initializeErrorAggregateTracker();
  
  recordToolError(tracker, "tool-1", "Error 1");
  recordToolError(tracker, "tool-2", "Error 2");
  
  const report = generateErrorReport(tracker);
  assert.equal(report.totalToolsWithErrors, 2);
  assert.ok(report.toolErrors.length > 0);
});

// ============================================================
// Quality Check Failed Handler Tests
// ============================================================

test("Quality Check Failed Handler - Initialize Tracker", () => {
  const tracker = initializeQualityCheckFailureTracker();
  
  assert.equal(tracker.failures.length, 0);
  assert.deepEqual(tracker.failuresByType, { skills: 0, tools: 0, presets: 0 });
});

test("Quality Check Failed Handler - Record Failure", () => {
  const tracker = initializeQualityCheckFailureTracker();
  
  const record = recordQualityCheckFailure(
    tracker,
    "skills",
    "bad-skill",
    ["Missing tags", "Too short"]
  );
  
  assert.equal(record.resourceType, "skills");
  assert.equal(record.errors.length, 2);
  assert.equal(tracker.failuresByType.skills, 1);
});

test("Quality Check Failed Handler - Detect Patterns", () => {
  const tracker = initializeQualityCheckFailureTracker();
  
  recordQualityCheckFailure(tracker, "skills", "skill-1", ["Missing tags"]);
  recordQualityCheckFailure(tracker, "tools", "tool-1", ["Missing tags"]);
  recordQualityCheckFailure(tracker, "presets", "preset-1", ["Missing tags"]);
  
  const patterns = detectFailurePatterns(tracker);
  assert.ok(patterns.length > 0, "Should detect common error pattern");
});

test("Quality Check Failed Handler - Generate Report", () => {
  const tracker = initializeQualityCheckFailureTracker();
  
  recordQualityCheckFailure(tracker, "skills", "skill-1", ["Error 1"]);
  
  const report = generateFailureReport(tracker);
  assert.equal(report.totalFailures, 1);
  assert.ok(report.suggestions.length >= 0);
});

// ============================================================
// Statistics Manager Tests
// ============================================================

test("Statistics Manager - Initialize", () => {
  const stats = initializeHandlersStatistics();
  
  assert.ok(stats.created);
  assert.ok(stats.deleted);
  assert.ok(stats.errors);
  assert.ok(stats.qualityFailures);
});

test("Statistics Manager - Generate Summary", () => {
  const stats = initializeHandlersStatistics();
  
  const summary = generateHandlersStatisticsSummary(stats);
  
  assert.ok(summary.resourceLifecycle);
  assert.equal(summary.resourceLifecycle.active, 0);
  assert.ok(summary.lastUpdated);
});

test("Statistics Manager - Export as JSON", () => {
  const stats = initializeHandlersStatistics();
  
  const json = exportStatisticsAsJson(stats);
  const parsed = JSON.parse(json);
  
  assert.ok(parsed.summary);
  assert.ok(parsed.detailed);
  assert.ok(parsed.timestamp);
});

// ============================================================
// Gap Handler Integration Test
// ============================================================

test("Resource Gap Handler - Full Flow", async () => {
  const gap = {
    detected: true,
    resourceType: "skills" as const,
    topic: "apex-testing",
    topScore: 2,
    threshold: 5,
    gapSeverity: "high" as const,
    timestamp: new Date().toISOString()
  };

  const result = await handleResourceGapDetected(
    gap,
    [],
    DEFAULT_HANDLER_CONFIG
  );

  assert.ok(result.suggestion);
  assert.equal(result.suggestion.resourceType, "skills");
  assert.ok(result.suggestion.name);
});

/**
 * Apply Resource Actions Quality Check Verification Test
 * 
 * apply_resource_actions で実装された品質チェック機能を検証
 * test: node --test tests/apply-resource-actions.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  checkSkillQuality,
  checkToolQuality,
  checkPresetQuality,
  SKILL_QUALITY_REQUIREMENTS,
  TOOL_QUALITY_REQUIREMENTS,
  PRESET_QUALITY_REQUIREMENTS
} from "../mcp/core/quality/quality-checker.js";

import {
  checkForDuplicates,
  checkNameDuplicate
} from "../mcp/core/quality/deduplication.js";

// ============================================================
// Skill Quality Tests
// ============================================================

test("Apply Resource Actions - Skill Quality: Valid", () => {
  const result = checkSkillQuality({
    name: "apex-testing-skill",
    tags: ["apex", "testing", "unit-test"],
    summary: "This is a comprehensive guide to testing Apex code",
    content: "# Apex Testing\n\nDetailed content about testing Apex code in Salesforce."
  });

  assert.ok(result.pass, "Should pass quality check");
  assert.ok(result.score >= 70, "Score should be decent");
});

test("Apply Resource Actions - Skill Quality: Invalid Name Too Short", () => {
  const result = checkSkillQuality({
    name: "a",
    tags: ["test"],
    summary: "Test skill"
  });

  assert.ok(!result.pass, "Should fail - name too short");
  assert.ok(
    result.errors.some(e => e.code === "SKILL_NAME_TOO_SHORT"),
    "Should have name too short error"
  );
});

test("Apply Resource Actions - Skill Quality: Missing Tags", () => {
  const result = checkSkillQuality({
    name: "test-skill",
    tags: ["single-tag"], // Only 1 tag, need >= 2
    summary: "Test skill description"
  });

  assert.ok(!result.pass || result.warnings.length > 0, "Should have warning about tags");
});

test("Apply Resource Actions - Skill Quality: Empty Summary", () => {
  const result = checkSkillQuality({
    name: "test-skill",
    tags: ["tag1", "tag2"],
    summary: "" // Empty
  });

  assert.ok(result.warnings.length > 0, "Should warn about missing description");
});

// ============================================================
// Tool Quality Tests
// ============================================================

test("Apply Resource Actions - Tool Quality: Valid", () => {
  const result = checkToolQuality({
    name: "custom-analysis-tool",
    description: "A comprehensive tool for analyzing Salesforce code patterns"
  });

  assert.ok(result.pass, "Should pass quality check");
});

test("Apply Resource Actions - Tool Quality: Invalid Description", () => {
  const result = checkToolQuality({
    name: "tool",
    description: "x" // Too short
  });

  assert.ok(
    result.warnings.some(w => w.code === "TOOL_INSUFFICIENT_DESCRIPTION"),
    "Should warn about insufficient description"
  );
});

test("Apply Resource Actions - Tool Quality: Name Too Long", () => {
  const result = checkToolQuality({
    name: "a".repeat(150), // Exceeds maxNameLength
    description: "Test"
  });

  assert.ok(!result.pass, "Should fail - name too long");
});

// ============================================================
// Preset Quality Tests
// ============================================================

test("Apply Resource Actions - Preset Quality: Valid", () => {
  const result = checkPresetQuality({
    name: "apex-development-preset",
    description: "Complete preset for Apex development workflow",
    agents: ["apex-developer", "qa-engineer", "architect"]
  });

  assert.ok(result.pass, "Should pass quality check");
});

test("Apply Resource Actions - Preset Quality: No Agents", () => {
  const result = checkPresetQuality({
    name: "empty-preset",
    description: "Preset with no agents",
    agents: [] // Empty agents array
  });

  assert.ok(!result.pass, "Should fail - no agents");
  assert.ok(
    result.errors.some(e => e.code === "PRESET_NO_AGENTS"),
    "Should require at least 1 agent"
  );
});

test("Apply Resource Actions - Preset Quality: Invalid Description", () => {
  const result = checkPresetQuality({
    name: "test-preset",
    description: "", // Empty
    agents: ["agent-1"]
  });

  assert.ok(result.warnings.length > 0, "Should warn about description");
});

// ============================================================
// Duplicate Detection Tests
// ============================================================

test("Apply Resource Actions - Duplicate Detection: Exact Match", () => {
  const newSkill = { name: "apex-skill", description: "Apex testing" };
  const existing = [
    { name: "apex-skill", description: "Apex testing" },
    { name: "lwc-skill", description: "LWC development" }
  ];

  const result = checkForDuplicates(newSkill, existing, 0.8);

  assert.ok(result.isDuplicate, "Should detect duplicate");
  assert.equal(result.similarity, 1.0, "Exact match should have 100% similarity");
});

test("Apply Resource Actions - Duplicate Detection: Similar", () => {
  const newSkill = { name: "apex testing", description: "Testing Apex" };
  const existing = [
    { name: "apex-testing", description: "Apex testing guide" },
    { name: "other-skill", description: "Something else" }
  ];

  const result = checkForDuplicates(newSkill, existing, 0.7);

  assert.ok(result.similarResources.length > 0, "Should find similar resource");
});

test("Apply Resource Actions - Duplicate Detection: Name Only", () => {
  const isDuplicate = checkNameDuplicate("test-skill", ["test-skill", "other"]);
  assert.ok(isDuplicate, "Should detect name duplicate");
});

test("Apply Resource Actions - Duplicate Detection: Case Insensitive", () => {
  const isDuplicate = checkNameDuplicate("TEST-SKILL", ["test-skill"]);
  assert.ok(isDuplicate, "Should be case-insensitive");
});

// ============================================================
// Integration: Quality + Duplicate Check
// ============================================================

test("Apply Resource Actions - Full Validation Flow: Pass", () => {
  const skillName = "new-apex-skill";
  const skillContent = "# New Apex Skill\n\nComprehensive content about apex testing";
  
  // Quality check
  const qualityResult = checkSkillQuality({
    name: skillName,
    tags: ["apex", "testing"],
    summary: "Comprehensive Apex testing skill",
    content: skillContent
  });

  assert.ok(qualityResult.pass, "Quality check should pass");

  // Duplicate check
  const existing = [
    { name: "other-skill", description: "Something else" }
  ];

  const dupResult = checkForDuplicates(
    { name: skillName, description: "Testing skill" },
    existing,
    0.8
  );

  assert.ok(!dupResult.isDuplicate, "Should not have duplicates");

  // Both should pass
  assert.ok(qualityResult.pass && !dupResult.isDuplicate, "Should pass all checks");
});

test("Apply Resource Actions - Full Validation Flow: Fail on Quality", () => {
  // Create a skill that fails quality check
  const qualityResult = checkSkillQuality({
    name: "x", // Too short
    tags: ["only-one"], // Should have >= 2
    summary: "x" // Too short
  });

  assert.ok(!qualityResult.pass, "Should fail quality check");
  assert.ok(qualityResult.errors.length > 0, "Should have errors");
});

test("Apply Resource Actions - Full Validation Flow: Fail on Duplicate", () => {
  const skillName = "apex testing";
  
  // Quality check passes
  const qualityResult = checkSkillQuality({
    name: skillName,
    tags: ["apex", "testing"],
    summary: "Good quality skill for testing apex",
    content: "# Apex Testing Content"
  });

  assert.ok(qualityResult.pass, "Quality check should pass");

  // But duplicate check fails (exact name match after normalization)
  const existing = [
    { name: "Apex Testing", description: "Existing apex testing skill for development" }
  ];

  const dupResult = checkForDuplicates(
    { name: skillName, description: "New skill for apex testing" },
    existing,
    0.8
  );

  // Should detect as duplicate due to name similarity
  assert.ok(dupResult.isDuplicate, "Should detect duplicate from name similarity");
});

// ============================================================
// Edge Cases
// ============================================================

test("Apply Resource Actions - Skill with Special Characters in Name", () => {
  const result = checkSkillQuality({
    name: "apex-skill-v2.0",
    tags: ["apex", "v2"],
    summary: "Version 2 of apex skill with (parentheses) and [brackets]"
  });

  // Should still pass even with special characters
  assert.ok(result.pass || result.warnings.length === result.errors.length, "Should handle special chars");
});

test("Apply Resource Actions - Very Long Tool Description", () => {
  const longDesc = "A".repeat(5000);
  const result = checkToolQuality({
    name: "long-tool",
    description: longDesc
  });

  assert.ok(result.pass, "Should pass with long description");
});

test("Apply Resource Actions - Unicode Characters in Names", () => {
  const result = checkSkillQuality({
    name: "スキル-apex",
    tags: ["unicode", "test"],
    summary: "Skill with Unicode characters 日本語"
  });

  // Should handle unicode gracefully
  assert.ok(typeof result === "object", "Should process unicode names");
});

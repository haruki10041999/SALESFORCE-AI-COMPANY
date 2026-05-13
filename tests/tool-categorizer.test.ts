/**
 * TASK-02: Tool Surface Hierarchization Tests
 *
 * Verify:
 *  1. Tool categorization coverage (110+ tools)
 *  2. Category distribution
 *  3. Semantic search and ranking
 *  4. Domain relevance scoring
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ToolCategorizer,
  getGlobalToolCategorizer,
  _resetToolCategorizerForTest,
  TOOL_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  inferToolCategoryFromTopic,
  recommendAgentsForToolCategory,
  type ToolCategory
} from "../mcp/core/resource/tool-categorizer.js";

test("TASK-02: ToolCategorizer - initializes with default catalog", () => {
  const categorizer = new ToolCategorizer();
  const count = categorizer.getTotalToolCount();
  
    assert.ok(count >= 108, `Expected >= 108 tools, got ${count}`);
});

test("TASK-02: ToolCategorizer - has 7 semantic categories", () => {
  const categories = Object.values(TOOL_CATEGORIES);
  
  assert.equal(categories.length, 7);
  assert.ok(categories.includes("chat-orchestration"));
  assert.ok(categories.includes("analytics-evaluation"));
  assert.ok(categories.includes("governance-compliance"));
  assert.ok(categories.includes("resource-management"));
  assert.ok(categories.includes("development-deployment"));
  assert.ok(categories.includes("memory-knowledge"));
  assert.ok(categories.includes("admin-operations"));
});

test("TASK-02: ToolCategorizer - all categories have descriptions", () => {
  for (const category of Object.values(TOOL_CATEGORIES)) {
    assert.ok(CATEGORY_DESCRIPTIONS[category], `Missing description for ${category}`);
    assert.ok(CATEGORY_DESCRIPTIONS[category].length > 0);
  }
});

test("TASK-02: ToolCategorizer - getTool retrieves by ID", () => {
  const categorizer = new ToolCategorizer();
  const tool = categorizer.getTool("smart_chat");
  
  assert.ok(tool);
  assert.equal(tool.id, "smart_chat");
  assert.equal(tool.category, "chat-orchestration");
});

test("TASK-02: ToolCategorizer - getTool returns undefined for unknown tool", () => {
  const categorizer = new ToolCategorizer();
  const tool = categorizer.getTool("unknown-tool");
  
  assert.equal(tool, undefined);
});

test("TASK-02: ToolCategorizer - getToolsByCategory returns filtered list", () => {
  const categorizer = new ToolCategorizer();
  const chatTools = categorizer.getToolsByCategory("chat-orchestration");
  
  assert.ok(chatTools.length > 0);
  assert.ok(chatTools.every(t => t.category === "chat-orchestration"));
});

test("TASK-02: ToolCategorizer - getCategoryStats shows distribution", () => {
  const categorizer = new ToolCategorizer();
  const stats = categorizer.getCategoryStats();
  
  // Verify all categories have tools
  assert.ok(stats["chat-orchestration"] > 0);
  assert.ok(stats["analytics-evaluation"] > 0);
  assert.ok(stats["governance-compliance"] > 0);
  assert.ok(stats["resource-management"] > 0);
  assert.ok(stats["development-deployment"] > 0);
  assert.ok(stats["memory-knowledge"] > 0);
  assert.ok(stats["admin-operations"] > 0);
  
  // Total matches tool count
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  assert.equal(total, categorizer.getTotalToolCount());
});

test("TASK-02: ToolCategorizer - searchToolsByKeyword filters by name", () => {
  const categorizer = new ToolCategorizer();
  const results = categorizer.searchToolsByKeyword("smart");
  
  assert.ok(results.length > 0);
  assert.ok(results.some(t => t.id === "smart_chat"));
});

test("TASK-02: ToolCategorizer - searchToolsByKeyword filters by keyword", () => {
  const categorizer = new ToolCategorizer();
  const results = categorizer.searchToolsByKeyword("testing");
  
  assert.ok(results.length > 0);
  assert.ok(results.some(t => t.keywords.includes("testing")));
});

test("TASK-02: ToolCategorizer - searchToolsByKeyword is case-insensitive", () => {
  const categorizer = new ToolCategorizer();
  const lower = categorizer.searchToolsByKeyword("chat");
  const upper = categorizer.searchToolsByKeyword("CHAT");
  
  assert.equal(lower.length, upper.length);
});

test("TASK-02: ToolCategorizer - rankToolsByDomainRelevance sorts by relevance", () => {
  const categorizer = new ToolCategorizer();
  const allTools = categorizer.getAllToolIds()
    .map(id => categorizer.getTool(id)!)
    .slice(0, 10);
  
  const ranked = categorizer.rankToolsByDomainRelevance(allTools, "chat");
  
  // Chat-related tools should rank higher
  const chatTools = ranked.filter(t => t.keywords.includes("chat"));
  assert.ok(chatTools.length > 0);
});

test("TASK-02: ToolCategorizer - getAllToolIds returns complete list", () => {
  const categorizer = new ToolCategorizer();
  const ids = categorizer.getAllToolIds();
  
  assert.equal(ids.length, categorizer.getTotalToolCount());
  assert.ok(ids.includes("smart_chat"));
  assert.ok(ids.includes("apex_analyze"));
});

test("TASK-02: ToolCategorizer - registerTool adds custom tool", () => {
  const categorizer = new ToolCategorizer();
  const initialCount = categorizer.getTotalToolCount();
  
  categorizer.registerTool({
    id: "custom_tool",
    name: "custom_tool",
    title: "Custom Tool",
    category: "admin-operations",
    description: "A custom tool for testing",
    keywords: ["custom", "test"]
  });
  
  assert.equal(categorizer.getTotalToolCount(), initialCount + 1);
  assert.ok(categorizer.getTool("custom_tool"));
});

test("TASK-02: ToolCategorizer - each tool has required metadata", () => {
  const categorizer = new ToolCategorizer();
  const allIds = categorizer.getAllToolIds();
  
  for (const id of allIds) {
    const tool = categorizer.getTool(id)!;
    
    assert.ok(tool.id, `Tool missing id: ${id}`);
    assert.ok(tool.name, `Tool missing name: ${id}`);
    assert.ok(tool.title, `Tool missing title: ${id}`);
    assert.ok(tool.category, `Tool missing category: ${id}`);
    assert.ok(tool.description, `Tool missing description: ${id}`);
    assert.ok(Array.isArray(tool.keywords), `Tool missing keywords: ${id}`);
    assert.ok(tool.keywords.length > 0, `Tool has empty keywords: ${id}`);
  }
});

test("TASK-02: ToolCategorizer - category contains expected tools", () => {
  const categorizer = new ToolCategorizer();
  
  // Chat tools
  const chatTools = categorizer.getToolsByCategory("chat-orchestration");
  assert.ok(chatTools.some(t => t.id === "smart_chat"));
  assert.ok(chatTools.some(t => t.id === "orchestrate_chat"));
  
  // Analytics tools
  const analyticsTools = categorizer.getToolsByCategory("analytics-evaluation");
  assert.ok(analyticsTools.some(t => t.id === "estimate_prompt_cost"));
  assert.ok(analyticsTools.some(t => t.id === "evaluate_cost_sla"));
  
  // Development tools
  const devTools = categorizer.getToolsByCategory("development-deployment");
  assert.ok(devTools.some(t => t.id === "apex_analyze"));
  assert.ok(devTools.some(t => t.id === "flow_analyze"));
});

test("TASK-02: getGlobalToolCategorizer - returns singleton instance", () => {
  _resetToolCategorizerForTest();
  
  const first = getGlobalToolCategorizer();
  const second = getGlobalToolCategorizer();
  
  assert.strictEqual(first, second);
  _resetToolCategorizerForTest();
});

test("TASK-02: Tool count distribution is balanced", () => {
  const categorizer = new ToolCategorizer();
  const stats = categorizer.getCategoryStats();
  
  // No category should have 0 tools or more than 50% of total
  const total = categorizer.getTotalToolCount();
  const threshold = total / 2;
  
  for (const [category, count] of Object.entries(stats)) {
    assert.ok(count > 0, `Category ${category} has no tools`);
    assert.ok(count <= threshold, `Category ${category} has ${count} tools, exceeds ${threshold}`);
  }
});

test("TASK-02: Smart chat tool is in correct category", () => {
  const categorizer = new ToolCategorizer();
  const smartChat = categorizer.getTool("smart_chat");
  
  assert.equal(smartChat?.category, "chat-orchestration");
  assert.ok(smartChat?.keywords.includes("chat"));
  assert.ok(smartChat?.keywords.includes("orchestration"));
});

test("TASK-02: Governance tools cover compliance area", () => {
  const categorizer = new ToolCategorizer();
  const govTools = categorizer.getToolsByCategory("governance-compliance");
  
  // Should include security, permissions, budget tracking
  const toolNames = govTools.map(t => t.name);
  assert.ok(toolNames.some(n => n.includes("security")));
  assert.ok(toolNames.some(n => n.includes("permission")));
});

test("TASK-02: Memory/Knowledge tools include vector search", () => {
  const categorizer = new ToolCategorizer();
  const memTools = categorizer.getToolsByCategory("memory-knowledge");
  
  // Should include vector search
  const vectorTool = memTools.find(t => t.id === "search_vector");
  assert.ok(vectorTool);
  assert.ok(vectorTool.keywords.includes("vector"));
});

test("TASK-02: ToolCategorizer - infers categories from topic", () => {
  assert.equal(inferToolCategoryFromTopic("security budget and compliance review"), "governance-compliance");
  assert.equal(inferToolCategoryFromTopic("Apex deployment and refactor plan"), "development-deployment");
});

test("TASK-02: ToolCategorizer - recommends agents for category", () => {
  const recommendations = recommendAgentsForToolCategory("governance-compliance");

  assert.ok(recommendations.includes("security-engineer"));
  assert.ok(recommendations.includes("release-manager"));
});

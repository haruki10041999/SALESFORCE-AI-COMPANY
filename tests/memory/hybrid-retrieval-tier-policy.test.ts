/**
 * T-17 increment 2: Hybrid Memory Retrieval with KG Reasoner
 * Tests for HierarchicalMemoryStore KG integration, MemoryTierPolicy, and LearningDashboard KG metrics
 */

import test from "node:test";
import assert from "node:assert/strict";
import { HierarchicalMemoryStore } from "../../memory/hierarchical-store.js";
import { MemoryChunker } from "../../memory/chunker.js";
import { MemoryTierPolicy, DEFAULT_TIER_CONFIG } from "../../mcp/core/memory/memory-tier-policy.js";

test("HierarchicalMemoryStore - prune cold documents", async () => {
  const chunker = new MemoryChunker();
  const store = new HierarchicalMemoryStore(chunker);

  const doc = `## Content\nTest document`;
  await store.ingestDocument("doc1", doc, "Doc 1", true);

  // Initially, documents are not cold yet
  let pruned = store.pruneColdDocuments(365);
  assert.equal(pruned, 0, "Should not prune recently added docs");

  // Document should still be retrievable
  const stats = store.getTierStatistics();
  assert.ok(stats.totalDocuments >= 1, "Should have at least 1 document");
});

test("HierarchicalMemoryStore - get tier statistics", async () => {
  const chunker = new MemoryChunker();
  const store = new HierarchicalMemoryStore(chunker);

  const doc1 = "Small content";
  const doc2 = "Medium\nLine 2\nLine 3\nLine 4\nLine 5";

  await store.ingestDocument("doc1", doc1, "Doc 1", false);
  await store.ingestDocument("doc2", doc2, "Doc 2", true);

  const stats = store.getTierStatistics();

  assert.equal(stats.totalDocuments, 2, "Should have 2 documents");
  assert.ok(stats.hot + stats.warm + stats.cold === 2, "All docs should be in some tier");
});

test("MemoryTierPolicy - classify by age and access", () => {
  const policy = new MemoryTierPolicy(DEFAULT_TIER_CONFIG);

  const hotMeta = {
    ageMs: 1 * 24 * 60 * 60 * 1000, // 1 day old
    sizeBytes: 1000,
    accessCount: 5,
    lastAccessMs: Date.now() - 1 * 60 * 60 * 1000 // 1 hour ago
  };

  const coldMeta = {
    ageMs: 200 * 24 * 60 * 60 * 1000, // 200 days old
    sizeBytes: 10000,
    accessCount: 1,
    lastAccessMs: Date.now() - 100 * 24 * 60 * 60 * 1000 // 100 days ago
  };

  assert.equal(policy.classifyTier(hotMeta), "hot");
  assert.equal(policy.classifyTier(coldMeta), "cold");
});

test("MemoryTierPolicy - promote and demote", () => {
  const policy = new MemoryTierPolicy();

  assert.equal(policy.promote("cold"), "warm");
  assert.equal(policy.promote("warm"), "hot");
  assert.equal(policy.promote("hot"), "hot");

  assert.equal(policy.demote("hot"), "warm");
  assert.equal(policy.demote("warm"), "cold");
  assert.equal(policy.demote("cold"), "cold");
});

test("MemoryTierPolicy - should prune old cold documents", () => {
  const config = { ...DEFAULT_TIER_CONFIG, coldPruneAfterDays: 100 };
  const policy = new MemoryTierPolicy(config);

  const oldColdMeta = {
    ageMs: 200 * 24 * 60 * 60 * 1000, // 200 days old
    lastAccessMs: Date.now() - 150 * 24 * 60 * 60 * 1000 // Not accessed in 150 days
  };

  const recentWarmMeta = {
    ageMs: 80 * 24 * 60 * 60 * 1000, // 80 days old
    lastAccessMs: Date.now() - 5 * 24 * 60 * 60 * 1000 // Accessed 5 days ago
  };

  assert.ok(policy.shouldPrune("cold", oldColdMeta), "Should prune old cold doc");
  assert.ok(!policy.shouldPrune("warm", recentWarmMeta), "Should not prune warm doc");
});

test("MemoryTierPolicy - track metrics", () => {
  const policy = new MemoryTierPolicy();

  policy.updateMetrics({
    totalDocuments: 100,
    totalSizeBytes: 1_000_000,
    hotCount: 40,
    warmCount: 50,
    coldCount: 10,
    prunedCount: 5,
    promotedCount: 2,
    demotedCount: 1
  });

  const metrics = policy.getMetrics();
  assert.equal(metrics.totalDocuments, 100);
  assert.equal(metrics.hotCount, 40);

  const distribution = policy.getTierDistribution();
  assert.equal(distribution.hot, 40);
  assert.equal(distribution.warm, 50);
  assert.equal(distribution.cold, 10);
});

test("MemoryTierPolicy - estimate storage cost", () => {
  const policy = new MemoryTierPolicy();

  policy.updateMetrics({
    totalDocuments: 100,
    totalSizeBytes: 10_000_000,
    hotCount: 40,
    warmCount: 50,
    coldCount: 10,
    prunedCount: 0,
    promotedCount: 0,
    demotedCount: 0
  });

  const cost = policy.estimateStorageCost();
  
  assert.ok(cost.hotCost > 0);
  assert.ok(cost.warmCost > 0);
  assert.ok(cost.coldCost > 0);
  assert.ok(cost.totalCost > 0);
  assert.ok(cost.hotCost > cost.coldCost); // Hot is more expensive than cold
});

test("MemoryTierPolicy - reset metrics", () => {
  const policy = new MemoryTierPolicy();

  policy.updateMetrics({
    totalDocuments: 100,
    hotCount: 50,
    warmCount: 30,
    coldCount: 20,
    totalSizeBytes: 1_000_000,
    prunedCount: 0,
    promotedCount: 0,
    demotedCount: 0
  });

  policy.resetMetrics();
  const metrics = policy.getMetrics();

  assert.equal(metrics.totalDocuments, 0);
  assert.equal(metrics.hotCount, 0);
  assert.equal(metrics.warmCount, 0);
  assert.equal(metrics.coldCount, 0);
});

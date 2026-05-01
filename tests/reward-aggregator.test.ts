/**
 * Tests for reward aggregation system
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "path";
import * as fs from "fs";
import {
  recordReward,
  loadAllRewards,
  loadRewardsForSession,
  loadRewardsForAgent,
  loadRewardsForTool,
  aggregateRewardsBySource,
  computeCompositeReward,
  syncRewardsToFeedback,
  getRewardStats
} from "../mcp/core/learning/reward-aggregator.js";

const testRewardsDir = path.resolve("outputs", "learning");

async function setupTest(): Promise<void> {
  try {
    await fs.promises.mkdir(testRewardsDir, { recursive: true });
  } catch {
    // ignored
  }
}

async function cleanupTest(): Promise<void> {
  try {
    await fs.promises.unlink(path.resolve(testRewardsDir, "rewards.jsonl"));
  } catch {
    // file may not exist
  }
}

function randomUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

test("recordReward creates reward record with auto-generated ID and timestamp", async () => {
  await setupTest();
  try {
    const reward = await recordReward({
      source: "test",
      reward: 0.8,
      sessionId: "test-session-1",
      agentName: "apex-developer"
    });

    assert.ok(reward.rewardId);
    assert.ok(reward.timestamp);
    assert.equal(reward.source, "test");
    assert.equal(reward.reward, 0.8);
    assert.equal(reward.confidence, 1.0);
  } finally {
    await cleanupTest();
  }
});

test("loadAllRewards returns all recorded rewards", async () => {
  await setupTest();
  try {
    const r1 = await recordReward({
      source: "test",
      reward: 0.9,
      sessionId: "session-1"
    });
    const r2 = await recordReward({
      source: "deployment",
      reward: 0.7,
      sessionId: "session-2"
    });

    const all = await loadAllRewards();
    assert.equal(all.length, 2);
    assert.ok(all.map((r) => r.rewardId).includes(r1.rewardId));
    assert.ok(all.map((r) => r.rewardId).includes(r2.rewardId));
  } finally {
    await cleanupTest();
  }
});

test("loadRewardsForSession filters by sessionId", async () => {
  await setupTest();
  try {
    await recordReward({
      source: "test",
      reward: 0.8,
      sessionId: "session-1"
    });
    await recordReward({
      source: "test",
      reward: 0.6,
      sessionId: "session-2"
    });
    await recordReward({
      source: "deployment",
      reward: 0.75,
      sessionId: "session-1"
    });

    const s1Rewards = await loadRewardsForSession("session-1");
    assert.equal(s1Rewards.length, 2);
    assert.ok(s1Rewards.every((r) => r.sessionId === "session-1"));

    const s2Rewards = await loadRewardsForSession("session-2");
    assert.equal(s2Rewards.length, 1);
  } finally {
    await cleanupTest();
  }
});

test("loadRewardsForAgent filters by agentName", async () => {
  await setupTest();
  try {
    await recordReward({
      source: "test",
      reward: 0.8,
      agentName: "apex-developer"
    });
    await recordReward({
      source: "test",
      reward: 0.6,
      agentName: "lwc-developer"
    });

    const apexRewards = await loadRewardsForAgent("apex-developer");
    assert.equal(apexRewards.length, 1);
    assert.equal(apexRewards[0].agentName, "apex-developer");
  } finally {
    await cleanupTest();
  }
});

test("loadRewardsForTool filters by toolName", async () => {
  await setupTest();
  try {
    await recordReward({
      source: "test",
      reward: 0.8,
      toolName: "apex-analyzer"
    });
    await recordReward({
      source: "test",
      reward: 0.6,
      toolName: "flow-analyzer"
    });

    const apexTools = await loadRewardsForTool("apex-analyzer");
    assert.equal(apexTools.length, 1);
    assert.equal(apexTools[0].toolName, "apex-analyzer");
  } finally {
    await cleanupTest();
  }
});

test("aggregateRewardsBySource computes statistics per source", async () => {
  await setupTest();
  try {
    // Test rewards
    await recordReward({ source: "test", reward: 0.9, confidence: 1.0 });
    await recordReward({ source: "test", reward: 0.8, confidence: 0.9 });

    // Deployment rewards
    await recordReward({ source: "deployment", reward: 0.7, confidence: 1.0 });

    const stats = await aggregateRewardsBySource();

    assert.ok(stats.has("test"));
    const testStats = stats.get("test")!;
    assert.equal(testStats.count, 2);
    assert.ok(Math.abs(testStats.avgReward - 0.85) < 1e-9, `avgReward expected ~0.85 got ${testStats.avgReward}`);
    assert.ok(Math.abs(testStats.confidence - 0.95) < 0.01);

    assert.ok(stats.has("deployment"));
    const deployStats = stats.get("deployment")!;
    assert.equal(deployStats.count, 1);
    assert.equal(deployStats.avgReward, 0.7);
  } finally {
    await cleanupTest();
  }
});

test("aggregateRewardsBySource respects minSamples", async () => {
  await setupTest();
  try {
    await recordReward({ source: "test", reward: 0.8 });
    await recordReward({ source: "token_cost", reward: 0.5 });
    await recordReward({ source: "token_cost", reward: 0.6 });

    const stats = await aggregateRewardsBySource({ minSamples: 2 });

    // Test has only 1 sample, should not appear
    assert.ok(!stats.has("test"));

    // token_cost has 2 samples, should appear
    assert.ok(stats.has("token_cost"));
  } finally {
    await cleanupTest();
  }
});

test("computeCompositeReward weights sources appropriately", async () => {
  await setupTest();
  try {
    // Record rewards with explicit weights
    await recordReward({
      source: "test",
      reward: 1.0,
      confidence: 1.0
    });
    await recordReward({
      source: "deployment",
      reward: 0.0,
      confidence: 1.0
    });

    const config = {
      testWeight: 0.7,
      deploymentWeight: 0.3,
      tokenCostWeight: 0,
      prReadinessWeight: 0,
      errorRecoveryWeight: 0
    };

    const result = await computeCompositeReward(config);

    // Composite = (1.0 * 0.7 * 1.0 + 0.0 * 0.3 * 1.0) / (0.7 * 1.0 + 0.3 * 1.0) = 0.7
    assert.ok(Math.abs(result.composite - 0.7) < 0.01);
    assert.ok(result.details.has("test"));
    assert.ok(result.details.has("deployment"));
  } finally {
    await cleanupTest();
  }
});

test("computeCompositeReward clamps result to [-1, 1]", async () => {
  await setupTest();
  try {
    await recordReward({
      source: "test",
      reward: 10.0, // Way out of range
      confidence: 1.0
    });

    const result = await computeCompositeReward();
    assert.ok(result.composite <= 1);
    assert.ok(result.composite >= -1);
  } finally {
    await cleanupTest();
  }
});

test("syncRewardsToFeedback converts rewards to feedback entries", async () => {
  await setupTest();
  try {
    const r1 = await recordReward({
      source: "test",
      reward: 0.8,
      reason: "Test passed",
      sessionId: "test-session",
      agentName: "apex-developer",
      toolName: "apex-analyzer"
    });

    const feedbacks = await syncRewardsToFeedback();
    assert.equal(feedbacks.length, 1);

    const feedback = feedbacks[0];
    assert.equal(feedback.rating, "thumbs-up"); // reward > 0.2
    assert.ok(Math.abs(feedback.qualityScore! - 0.9) < 0.01); // (0.8 + 1) / 2
    assert.equal(feedback.comment, "Test passed");
    assert.ok(feedback.tags?.includes("source:test"));
    assert.ok(feedback.tags?.includes(`reward:${r1.rewardId}`));
  } finally {
    await cleanupTest();
  }
});

test("syncRewardsToFeedback skips already-converted rewards", async () => {
  await setupTest();
  try {
    await recordReward({ source: "test", reward: 0.5 });

    // First call converts the reward
    const first = await syncRewardsToFeedback();
    assert.ok(first.length >= 1);

    // Second call should skip already-converted rewards
    const second = await syncRewardsToFeedback();
    assert.equal(second.length, 0);
  } finally {
    await cleanupTest();
  }
});

test("getRewardStats computes statistics within time window", async () => {
  await setupTest();
  try {
    await recordReward({ source: "test", reward: 0.9 });
    await recordReward({ source: "test", reward: 0.7 });
    await recordReward({ source: "test", reward: 0.5 });

    const stats = await getRewardStats(24);

    assert.equal(stats.totalCount, 3);
    assert.ok(Math.abs(stats.avgReward - 0.7) < 0.2);
    assert.equal(stats.minReward, 0.5);
    assert.equal(stats.maxReward, 0.9);
    assert.ok(stats.positiveRate === 1.0); // All positive
    assert.ok(stats.stdDev > 0);
  } finally {
    await cleanupTest();
  }
});

test("getRewardStats filters by source", async () => {
  await setupTest();
  try {
    await recordReward({ source: "test", reward: 0.9 });
    await recordReward({ source: "deployment", reward: 0.3 });

    const testStats = await getRewardStats(24, "test");
    assert.equal(testStats.totalCount, 1);
    assert.equal(testStats.avgReward, 0.9);

    const deployStats = await getRewardStats(24, "deployment");
    assert.equal(deployStats.totalCount, 1);
    assert.equal(deployStats.avgReward, 0.3);
  } finally {
    await cleanupTest();
  }
});

test("getRewardStats returns zeros for empty window", async () => {
  await setupTest();
  try {
    // Negative time window means no data
    const stats = await getRewardStats(0.0001);
    assert.equal(stats.totalCount, 0);
    assert.equal(stats.avgReward, 0);
  } finally {
    await cleanupTest();
  }
});

/**
 * Tests for drift-detector.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { promises as fsPromises } from "fs";
import { resolve, dirname } from "path";
import type { RewardRecord } from "../mcp/core/types/feedback.js";
import type { AgentReputationRecord } from "../mcp/core/learning/agent-reputation.js";
import {
  detectRewardDrift,
  detectAgentRegression,
  generateDriftReport,
  saveDriftReport,
  loadDriftReports,
  getLatestDriftReport,
  runDriftDetectionAndPersist
} from "../mcp/core/learning/drift-detector.js";

const TMP_DIR = resolve("outputs", "learning", "drift-detector-test");
const REWARD_PATH = resolve(TMP_DIR, "rewards.jsonl");
const REPUTATION_PATH = resolve(TMP_DIR, "agent-reputation.jsonl");
const REPORT_PATH = resolve(TMP_DIR, "drift-report.jsonl");

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fsPromises.writeFile(filePath, content.length > 0 ? `${content}\n` : "");
}

function makeReward(hoursAgo: number, reward: number, agentName = "agent-a"): RewardRecord {
  return {
    rewardId: `r-${Math.random().toString(36).slice(2)}`,
    source: "test",
    reward,
    confidence: 1,
    agentName,
    timestamp: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
  };
}

function makeReputation(
  hoursAgo: number,
  agentName: string,
  scoreAfter: number,
  scoreBefore: number
): AgentReputationRecord {
  return {
    id: `rep-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    agentName,
    scope: "global",
    scopeKey: "global",
    delta: Number((scoreAfter - scoreBefore).toFixed(3)),
    scoreBefore,
    scoreAfter
  };
}

async function cleanup(): Promise<void> {
  try {
    await fsPromises.rm(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

test("detectRewardDrift detects significant reward mean shift", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];

    for (let i = 0; i < 30; i++) {
      rewards.push(makeReward(30 + i, 0.7));
    }
    for (let i = 0; i < 30; i++) {
      rewards.push(makeReward(i % 20, 0.2));
    }

    await writeJsonl(REWARD_PATH, rewards);

    const result = await detectRewardDrift({
      baselineHours: 72,
      recentHours: 24,
      minRecentSamples: 20,
      driftThreshold: 0.15,
      rewardFilePath: REWARD_PATH
    });

    assert.equal(result.isDriftDetected, true);
    assert.ok(result.meanShift < 0);
    assert.ok(result.recentSamples >= 20);
  } finally {
    await cleanup();
  }
});

test("detectRewardDrift returns no drift when distributions are stable", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];

    for (let i = 0; i < 30; i++) {
      rewards.push(makeReward(30 + i, 0.5));
    }
    for (let i = 0; i < 30; i++) {
      rewards.push(makeReward(i % 20, 0.52));
    }

    await writeJsonl(REWARD_PATH, rewards);

    const result = await detectRewardDrift({
      baselineHours: 72,
      recentHours: 24,
      minRecentSamples: 20,
      driftThreshold: 0.15,
      rewardFilePath: REWARD_PATH
    });

    assert.equal(result.isDriftDetected, false);
    assert.ok(Math.abs(result.meanShift) < 0.15);
  } finally {
    await cleanup();
  }
});

test("detectAgentRegression finds regressed agents", async () => {
  await cleanup();
  try {
    const rows: AgentReputationRecord[] = [];

    for (let i = 0; i < 5; i++) {
      rows.push(makeReputation(40 + i, "agent-a", 0.85, 0.8));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(makeReputation(10 + i, "agent-a", 0.6, 0.65));
    }

    for (let i = 0; i < 5; i++) {
      rows.push(makeReputation(40 + i, "agent-b", 0.7, 0.68));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(makeReputation(10 + i, "agent-b", 0.72, 0.7));
    }

    await writeJsonl(REPUTATION_PATH, rows);

    const result = await detectAgentRegression({
      baselineHours: 72,
      recentHours: 24,
      minSamplesPerWindow: 3,
      regressionThreshold: 0.1,
      reputationFilePath: REPUTATION_PATH
    });

    assert.equal(result.hasRegression, true);
    assert.ok(result.regressedAgents.some((item) => item.agentName === "agent-a"));
    assert.ok(result.regressedAgents.every((item) => item.regressionDelta <= -0.1));
  } finally {
    await cleanup();
  }
});

test("generateDriftReport sets alerts when drift or regression exists", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 25; i++) rewards.push(makeReward(50 + i, 0.8));
    for (let i = 0; i < 25; i++) rewards.push(makeReward(i % 20, 0.2));
    await writeJsonl(REWARD_PATH, rewards);

    const reputations: AgentReputationRecord[] = [];
    for (let i = 0; i < 4; i++) reputations.push(makeReputation(40 + i, "agent-a", 0.9, 0.85));
    for (let i = 0; i < 4; i++) reputations.push(makeReputation(5 + i, "agent-a", 0.6, 0.65));
    await writeJsonl(REPUTATION_PATH, reputations);

    const report = await generateDriftReport({
      baselineHours: 72,
      recentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.15,
      minReputationSamplesPerWindow: 3,
      regressionThreshold: 0.1,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH
    });

    assert.equal(report.shouldAlert, true);
    assert.ok(report.alerts.length > 0);
  } finally {
    await cleanup();
  }
});

test("save/load/getLatest drift reports work", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [makeReward(50, 0.6), makeReward(10, 0.55), makeReward(8, 0.57), makeReward(6, 0.54)];
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    const report = await generateDriftReport({
      baselineHours: 72,
      recentHours: 24,
      minRecentRewardSamples: 1,
      rewardDriftThreshold: 0.3,
      minReputationSamplesPerWindow: 2,
      regressionThreshold: 0.2,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH
    });

    await saveDriftReport(report, REPORT_PATH);
    const reports = await loadDriftReports(REPORT_PATH, 10);
    const latest = await getLatestDriftReport(REPORT_PATH);

    assert.ok(reports.length >= 1);
    assert.ok(latest);
    assert.equal(latest?.reportId, report.reportId);
  } finally {
    await cleanup();
  }
});

test("runDriftDetectionAndPersist creates persisted report", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 25; i++) rewards.push(makeReward(50 + i, 0.65));
    for (let i = 0; i < 25; i++) rewards.push(makeReward(i % 20, 0.45));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    const report = await runDriftDetectionAndPersist({
      baselineHours: 72,
      recentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.1,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      reportPath: REPORT_PATH
    });

    assert.ok(report.reportId.length > 0);
    const latest = await getLatestDriftReport(REPORT_PATH);
    assert.ok(latest);
    assert.equal(latest?.reportId, report.reportId);
  } finally {
    await cleanup();
  }
});

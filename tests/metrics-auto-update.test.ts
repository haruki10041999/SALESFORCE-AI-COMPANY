import { test } from "node:test";
import { strict as assert } from "node:assert";
import { promises as fsPromises } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RewardRecord } from "../mcp/core/types/feedback.js";
import { runMetricsAutoUpdate } from "../mcp/core/learning/metrics-auto-update.js";

const TMP_DIR = resolve("outputs", "learning", "metrics-auto-update-test");
const REWARD_PATH = resolve(TMP_DIR, "rewards.jsonl");
const REPUTATION_PATH = resolve(TMP_DIR, "agent-reputation.jsonl");
const REPORT_PATH = resolve(TMP_DIR, "drift-report.jsonl");

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fsPromises.writeFile(filePath, content.length > 0 ? `${content}\n` : "", "utf-8");
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

async function cleanup(): Promise<void> {
  await fsPromises.rm(TMP_DIR, { recursive: true, force: true });
}

test("metrics-auto-update emits drift alert callback when alert is detected", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 30; i++) rewards.push(makeReward(40 + i, 0.85));
    for (let i = 0; i < 30; i++) rewards.push(makeReward(i % 20, 0.2));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    let callbackCount = 0;
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.15,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH,
      onDriftAlert: () => {
        callbackCount += 1;
      }
    });

    assert.equal(result.driftReport?.shouldAlert, true);
    assert.equal(result.driftAlertEmitted, true);
    assert.equal(callbackCount, 1);
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update does not emit drift callback when alert is not detected", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [];
    for (let i = 0; i < 30; i++) rewards.push(makeReward(40 + i, 0.5));
    for (let i = 0; i < 30; i++) rewards.push(makeReward(i % 20, 0.52));
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    let callbackCount = 0;
    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 20,
      rewardDriftThreshold: 0.2,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH,
      onDriftAlert: () => {
        callbackCount += 1;
      }
    });

    assert.equal(result.driftReport?.shouldAlert, false);
    assert.equal(result.driftAlertEmitted, false);
    assert.equal(callbackCount, 0);
  } finally {
    await cleanup();
  }
});

test("metrics-auto-update supports adaptive drift threshold options", async () => {
  await cleanup();
  try {
    const rewards: RewardRecord[] = [
      makeReward(40, 0.1),
      makeReward(41, 0.9),
      makeReward(42, 0.2),
      makeReward(43, 0.8),
      makeReward(2, 0.4),
      makeReward(3, 0.9),
      makeReward(4, 0.3),
      makeReward(5, 0.8)
    ];
    await writeJsonl(REWARD_PATH, rewards);
    await writeJsonl(REPUTATION_PATH, []);

    const result = await runMetricsAutoUpdate({
      reportingHours: 24,
      includeDriftDetection: true,
      driftBaselineHours: 72,
      driftRecentHours: 24,
      minRecentRewardSamples: 4,
      rewardDriftThreshold: 0.15,
      adaptiveRewardDriftThreshold: true,
      rewardFilePath: REWARD_PATH,
      reputationFilePath: REPUTATION_PATH,
      driftReportPath: REPORT_PATH
    });

    assert.ok(result.driftReport);
    assert.equal(result.driftReport?.rewardDrift.adaptiveThresholdEnabled, true);
    assert.ok((result.driftReport?.rewardDrift.effectiveDriftThreshold ?? 0) >= 0.15);
  } finally {
    await cleanup();
  }
});

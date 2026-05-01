/**
 * Drift and regression detector for learning signals.
 * Monitors reward distribution drift and agent reputation regression.
 */

import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import type { RewardRecord } from "../types/feedback.js";
import type { AgentReputationRecord } from "./agent-reputation.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

const DEFAULT_REWARD_PATH = resolve("outputs", "learning", "rewards.jsonl");
const DEFAULT_REPUTATION_PATH = resolve("outputs", "agent-reputation.jsonl");
const DEFAULT_REPORT_PATH = resolve("outputs", "reports", "drift-regression.jsonl");

export interface RewardDriftResult {
  baselineHours: number;
  recentHours: number;
  baselineSamples: number;
  recentSamples: number;
  baselineAvgReward: number;
  recentAvgReward: number;
  baselineStdDev: number;
  recentStdDev: number;
  meanShift: number;
  varianceShift: number;
  driftScore: number;
  isDriftDetected: boolean;
}

export interface AgentRegressionItem {
  agentName: string;
  baselineAvgScore: number;
  recentAvgScore: number;
  regressionDelta: number;
  baselineSamples: number;
  recentSamples: number;
  isRegressed: boolean;
}

export interface AgentRegressionResult {
  baselineHours: number;
  recentHours: number;
  regressionThreshold: number;
  checkedAgents: number;
  regressedAgents: AgentRegressionItem[];
  hasRegression: boolean;
}

export interface DriftReport {
  reportId: string;
  timestamp: string;
  rewardDrift: RewardDriftResult;
  agentRegression: AgentRegressionResult;
  shouldAlert: boolean;
  alerts: string[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

async function loadRewardRecords(filePath = DEFAULT_REWARD_PATH): Promise<RewardRecord[]> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as RewardRecord;
        } catch {
          return null;
        }
      })
      .filter((row): row is RewardRecord => row !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Failed to load reward records: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadReputationRecords(filePath = DEFAULT_REPUTATION_PATH): Promise<AgentReputationRecord[]> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as AgentReputationRecord;
        } catch {
          return null;
        }
      })
      .filter((row): row is AgentReputationRecord => row !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Failed to load reputation records: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function detectRewardDrift(options?: {
  baselineHours?: number;
  recentHours?: number;
  minRecentSamples?: number;
  driftThreshold?: number;
  rewardFilePath?: string;
}): Promise<RewardDriftResult> {
  const baselineHours = options?.baselineHours ?? 24 * 7;
  const recentHours = options?.recentHours ?? 24;
  const minRecentSamples = options?.minRecentSamples ?? 20;
  const driftThreshold = options?.driftThreshold ?? 0.15;
  const rewardFilePath = options?.rewardFilePath ?? DEFAULT_REWARD_PATH;

  const allRewards = await loadRewardRecords(rewardFilePath);

  const now = Date.now();
  const recentCutoff = now - recentHours * 60 * 60 * 1000;
  const baselineCutoff = now - baselineHours * 60 * 60 * 1000;

  const recentRewards = allRewards.filter((r) => {
    const ts = new Date(r.timestamp).getTime();
    return ts >= recentCutoff;
  });

  const baselineRewards = allRewards.filter((r) => {
    const ts = new Date(r.timestamp).getTime();
    return ts >= baselineCutoff && ts < recentCutoff;
  });

  const recentValues = recentRewards.map((r) => r.reward);
  const baselineValues = baselineRewards.map((r) => r.reward);

  const baselineAvgReward = mean(baselineValues);
  const recentAvgReward = mean(recentValues);
  const baselineStd = stdDev(baselineValues);
  const recentStd = stdDev(recentValues);

  const meanShift = recentAvgReward - baselineAvgReward;
  const varianceShift = recentStd - baselineStd;
  const driftScore = Math.abs(meanShift) + 0.5 * Math.abs(varianceShift);

  const isDriftDetected =
    recentValues.length >= minRecentSamples &&
    baselineValues.length > 0 &&
    (Math.abs(meanShift) >= driftThreshold || driftScore >= driftThreshold * 1.25);

  return {
    baselineHours,
    recentHours,
    baselineSamples: baselineValues.length,
    recentSamples: recentValues.length,
    baselineAvgReward,
    recentAvgReward,
    baselineStdDev: baselineStd,
    recentStdDev: recentStd,
    meanShift,
    varianceShift,
    driftScore,
    isDriftDetected
  };
}

export async function detectAgentRegression(options?: {
  baselineHours?: number;
  recentHours?: number;
  minSamplesPerWindow?: number;
  regressionThreshold?: number;
  reputationFilePath?: string;
}): Promise<AgentRegressionResult> {
  const baselineHours = options?.baselineHours ?? 24 * 7;
  const recentHours = options?.recentHours ?? 24;
  const minSamplesPerWindow = options?.minSamplesPerWindow ?? 3;
  const regressionThreshold = options?.regressionThreshold ?? 0.1;
  const reputationFilePath = options?.reputationFilePath ?? DEFAULT_REPUTATION_PATH;

  const records = await loadReputationRecords(reputationFilePath);
  const globalRecords = records.filter((record) => record.scope === "global");

  const now = Date.now();
  const recentCutoff = now - recentHours * 60 * 60 * 1000;
  const baselineCutoff = now - baselineHours * 60 * 60 * 1000;

  const byAgent = new Map<string, AgentReputationRecord[]>();
  for (const record of globalRecords) {
    if (!byAgent.has(record.agentName)) {
      byAgent.set(record.agentName, []);
    }
    byAgent.get(record.agentName)!.push(record);
  }

  const regressedAgents: AgentRegressionItem[] = [];

  for (const [agentName, agentRecords] of byAgent.entries()) {
    const recent = agentRecords.filter((record) => new Date(record.timestamp).getTime() >= recentCutoff);
    const baseline = agentRecords.filter((record) => {
      const ts = new Date(record.timestamp).getTime();
      return ts >= baselineCutoff && ts < recentCutoff;
    });

    if (recent.length < minSamplesPerWindow || baseline.length < minSamplesPerWindow) {
      continue;
    }

    const recentAvgScore = mean(recent.map((record) => record.scoreAfter));
    const baselineAvgScore = mean(baseline.map((record) => record.scoreAfter));
    const regressionDelta = recentAvgScore - baselineAvgScore;

    const isRegressed = regressionDelta <= -Math.abs(regressionThreshold);
    if (isRegressed) {
      regressedAgents.push({
        agentName,
        baselineAvgScore,
        recentAvgScore,
        regressionDelta,
        baselineSamples: baseline.length,
        recentSamples: recent.length,
        isRegressed
      });
    }
  }

  regressedAgents.sort((a, b) => a.regressionDelta - b.regressionDelta);

  return {
    baselineHours,
    recentHours,
    regressionThreshold,
    checkedAgents: byAgent.size,
    regressedAgents,
    hasRegression: regressedAgents.length > 0
  };
}

export async function generateDriftReport(options?: {
  baselineHours?: number;
  recentHours?: number;
  minRecentRewardSamples?: number;
  rewardDriftThreshold?: number;
  minReputationSamplesPerWindow?: number;
  regressionThreshold?: number;
  rewardFilePath?: string;
  reputationFilePath?: string;
}): Promise<DriftReport> {
  const rewardDrift = await detectRewardDrift({
    baselineHours: options?.baselineHours,
    recentHours: options?.recentHours,
    minRecentSamples: options?.minRecentRewardSamples,
    driftThreshold: options?.rewardDriftThreshold,
    rewardFilePath: options?.rewardFilePath
  });

  const agentRegression = await detectAgentRegression({
    baselineHours: options?.baselineHours,
    recentHours: options?.recentHours,
    minSamplesPerWindow: options?.minReputationSamplesPerWindow,
    regressionThreshold: options?.regressionThreshold,
    reputationFilePath: options?.reputationFilePath
  });

  const alerts: string[] = [];
  if (rewardDrift.isDriftDetected) {
    alerts.push(
      `Reward drift detected (mean shift=${rewardDrift.meanShift.toFixed(3)}, score=${rewardDrift.driftScore.toFixed(3)})`
    );
  }
  if (agentRegression.hasRegression) {
    alerts.push(`Agent regression detected for ${agentRegression.regressedAgents.length} agents`);
  }

  return {
    reportId: randomUUID(),
    timestamp: new Date().toISOString(),
    rewardDrift,
    agentRegression,
    shouldAlert: alerts.length > 0,
    alerts
  };
}

export async function saveDriftReport(
  report: DriftReport,
  reportPath: string = DEFAULT_REPORT_PATH
): Promise<void> {
  await fsPromises.mkdir(dirname(reportPath), { recursive: true });
  await appendTextFileAtomic(reportPath, `${JSON.stringify(report)}\n`);
}

export async function loadDriftReports(
  reportPath: string = DEFAULT_REPORT_PATH,
  limit = 50
): Promise<DriftReport[]> {
  try {
    const raw = await fsPromises.readFile(reportPath, "utf-8");
    const parsed = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as DriftReport;
        } catch {
          return null;
        }
      })
      .filter((row): row is DriftReport => row !== null);

    return parsed.slice(-Math.max(1, limit)).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Failed to load drift reports: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getLatestDriftReport(reportPath: string = DEFAULT_REPORT_PATH): Promise<DriftReport | null> {
  const reports = await loadDriftReports(reportPath, 1);
  return reports.length > 0 ? reports[0] : null;
}

export async function runDriftDetectionAndPersist(options?: {
  baselineHours?: number;
  recentHours?: number;
  minRecentRewardSamples?: number;
  rewardDriftThreshold?: number;
  minReputationSamplesPerWindow?: number;
  regressionThreshold?: number;
  rewardFilePath?: string;
  reputationFilePath?: string;
  reportPath?: string;
}): Promise<DriftReport> {
  const report = await generateDriftReport(options);
  await saveDriftReport(report, options?.reportPath ?? DEFAULT_REPORT_PATH);
  return report;
}

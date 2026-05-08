/**
 * Learning progress dashboard generator
 * Aggregates metrics from all learning subsystems and produces comprehensive report
 */

import { promises as fsPromises } from "fs";
import { resolve } from "path";
import type {
  LearningProgressDashboard,
  BanditMetrics,
  ReputationDistributionMetrics,
  ProposalMetrics,
  SelfRefineMetrics,
  PromptTemplateQualityMetrics,
  ErrorRecoveryMetrics
} from "../types/learning-dashboard.js";
import { getRewardStats } from "./reward-aggregator.js";
import { loadAgentReputationRecords } from "./agent-reputation.js";
import { getRewardHealth } from "./feedback-manager.js";
import { OutputsArtifactWriter } from "../persistence/outputs-artifact-writer.js";

const DASHBOARD_PATH = resolve("outputs", "dashboards", "learning-progress.json");
const artifactWriter = new OutputsArtifactWriter({
  outputsDir: process.env.SF_AI_OUTPUTS_DIR ? resolve(process.env.SF_AI_OUTPUTS_DIR) : resolve("outputs"),
  databaseUrl: process.env.DATABASE_URL
});

/**
 * Compute bandit convergence metrics
 */
async function computeBanditMetrics(hours: number = 24): Promise<BanditMetrics | undefined> {
  const stats = await getRewardStats(hours, "bandit");

  if (stats.totalCount === 0) {
    return undefined;
  }

  const convergenceStatus =
    stats.totalCount < 10 ? "cold" : stats.stdDev < 0.2 ? "converged" : "exploring";

  return {
    banditName: "agent-selection",
    totalSelections: stats.totalCount,
    totalReward: 0, // Would be computed from actual bandit state
    avgReward: stats.avgReward,
    estimatedRegret: 0, // Would be computed from regret analysis
    convergenceStatus,
    optimalArmSelectionRate: 0, // Would be tracked from bandit state
    arms: [], // Would be populated from bandit arms
    windowHours: hours,
    snapshotTime: new Date().toISOString()
  };
}

/**
 * Compute reputation distribution metrics
 */
async function computeReputationMetrics(): Promise<ReputationDistributionMetrics | undefined> {
  try {
    const records = await loadAgentReputationRecords("outputs/agent-reputation.jsonl");

    if (records.length === 0) {
      return undefined;
    }

    // Extract unique agent names and compute their global reputation
    const agentNames = new Set(records.filter((r) => r.scope === "global").map((r) => r.agentName));

    if (agentNames.size === 0) {
      return undefined;
    }

    const scores: number[] = [];
    for (const agentName of agentNames) {
      const globalScore = records
        .filter((r) => r.agentName === agentName && r.scope === "global")
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-1)[0]?.scoreAfter;

      if (typeof globalScore === "number") {
        scores.push(globalScore);
      }
    }

    if (scores.length === 0) {
      return undefined;
    }

    scores.sort((a, b) => a - b);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sq, s) => sq + Math.pow(s - mean, 2), 0) / scores.length;

    return {
      percentile25: scores[Math.floor(scores.length * 0.25)],
      percentile50: scores[Math.floor(scores.length * 0.5)],
      percentile75: scores[Math.floor(scores.length * 0.75)],
      percentile90: scores[Math.floor(scores.length * 0.9)],
      mean,
      stdDev: Math.sqrt(variance),
      min: scores[0],
      max: scores[scores.length - 1],
      agentCount: agentNames.size,
      stabilityScore: 1 - Math.min(1, variance), // Lower variance = higher stability
      snapshotTime: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

/**
 * Compute proposal metrics (stub for demonstration)
 */
async function computeProposalMetrics(): Promise<ProposalMetrics | undefined> {
  // Would read from outputs/tool-proposals/ and outputs/presets/ etc.
  return {
    totalProposals: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
    adoptionRate: 0,
    avgTimeToApproval: 0,
    byType: {
      skill: { total: 0, approved: 0 },
      tool: { total: 0, approved: 0 },
      preset: { total: 0, approved: 0 }
    },
    recentTrend: {
      proposalsCreatedPastWeek: 0,
      proposalsApprovedPastWeek: 0
    },
    snapshotTime: new Date().toISOString()
  };
}

/**
 * Compute self-refine metrics (stub)
 */
async function computeSelfRefineMetrics(): Promise<SelfRefineMetrics | undefined> {
  // Would read from outputs/learning/feedback.jsonl filtering for self-refine sessions
  return {
    avgIterations: 0,
    maxIterations: 0,
    minIterations: 0,
    convergenceRate: 0,
    avgQualityImprovement: 0,
    totalSessions: 0,
    windowHours: 24,
    snapshotTime: new Date().toISOString()
  };
}

/**
 * Compute prompt template quality metrics (stub)
 */
async function computePromptMetrics(): Promise<PromptTemplateQualityMetrics | undefined> {
  // Would read from outputs/prompts/ and prompt-cache.jsonl
  return {
    totalTemplates: 0,
    activeCount: 0,
    promotedCount: 0,
    retiredCount: 0,
    avgActiveQuality: 0,
    qualityTrend: 0,
    templates: [],
    snapshotTime: new Date().toISOString()
  };
}

/**
 * Compute error recovery metrics (stub)
 */
async function computeErrorRecoveryMetrics(hours: number = 24): Promise<ErrorRecoveryMetrics | undefined> {
  // Would read from outputs/operations-log.jsonl
  return {
    totalErrors: 0,
    recoveredCount: 0,
    recoveryRate: 0,
    byErrorType: [],
    avgRecoveryTime: 0,
    windowHours: hours,
    snapshotTime: new Date().toISOString()
  };
}

/**
 * Generate complete learning progress dashboard
 */
export async function generateLearningProgressDashboard(
  reportingHours: number = 24
): Promise<LearningProgressDashboard> {
  const now = new Date();

  const banditMetrics = await computeBanditMetrics(reportingHours);
  const reputationMetrics = await computeReputationMetrics();
  const proposalMetrics = await computeProposalMetrics();
  const selfRefineMetrics = await computeSelfRefineMetrics();
  const promptMetrics = await computePromptMetrics();
  const errorRecoveryMetrics = await computeErrorRecoveryMetrics(reportingHours);

  // Compute overall health score
  const healthComponents: number[] = [];
  if (banditMetrics && banditMetrics.convergenceStatus !== "cold") {
    healthComponents.push(banditMetrics.convergenceStatus === "converged" ? 1.0 : 0.6);
  }
  if (reputationMetrics && reputationMetrics.stabilityScore) {
    healthComponents.push(reputationMetrics.stabilityScore);
  }
  if (proposalMetrics && proposalMetrics.adoptionRate) {
    healthComponents.push(proposalMetrics.adoptionRate);
  }
  if (errorRecoveryMetrics && errorRecoveryMetrics.recoveryRate) {
    healthComponents.push(errorRecoveryMetrics.recoveryRate);
  }

  const healthScore =
    healthComponents.length > 0
      ? healthComponents.reduce((a, b) => a + b, 0) / healthComponents.length
      : 0.5;

  // Build recommendations
  const recommendations: LearningProgressDashboard["recommendations"] = [];

  if (banditMetrics?.convergenceStatus === "cold") {
    recommendations.push({
      subsystem: "bandit",
      priority: "high",
      action: "Collect more reward signals to warm up the bandit",
      reason: "Bandit has insufficient data for reliable arm selection"
    });
  }

  if (reputationMetrics && reputationMetrics.stdDev > 0.4) {
    recommendations.push({
      subsystem: "reputation",
      priority: "medium",
      action: "Investigate high variance in agent reputation scores",
      reason: "Reputation distribution is too spread out, indicates inconsistent performance"
    });
  }

  if (proposalMetrics && proposalMetrics.totalProposals > 0 && proposalMetrics.adoptionRate < 0.3) {
    recommendations.push({
      subsystem: "proposals",
      priority: "medium",
      action: "Review and approve pending proposals",
      reason: `Low adoption rate (${(proposalMetrics.adoptionRate * 100).toFixed(1)}%)`
    });
  }

  if (errorRecoveryMetrics && errorRecoveryMetrics.recoveryRate < 0.7) {
    recommendations.push({
      subsystem: "error-recovery",
      priority: "high",
      action: "Enhance error recovery mechanisms",
      reason: `Recovery rate is below 70% (${(errorRecoveryMetrics.recoveryRate * 100).toFixed(1)}%)`
    });
  }

  // Check reward health
  const rewardHealth = await getRewardHealth(reportingHours);
  if (!rewardHealth.isHealthy) {
    recommendations.push({
      subsystem: "rewards",
      priority: "high",
      action: "Investigate missing reward signals",
      reason: rewardHealth.warning || "No reward signals in the reporting period"
    });
  }

  const dashboard: LearningProgressDashboard = {
    version: "1.0.0",
    generatedAt: now.toISOString(),
    reportingHours,
    healthScore,
    lastProgressAt: now.toISOString(), // Would be tracked from actual events
    milestones: [], // Would be populated from event logs
    bandit: banditMetrics ? [banditMetrics] : undefined,
    reputation: reputationMetrics || undefined,
    proposals: proposalMetrics || undefined,
    selfRefine: selfRefineMetrics || undefined,
    prompts: promptMetrics || undefined,
    errorRecovery: errorRecoveryMetrics || undefined,
    recommendations
  };

  return dashboard;
}

/**
 * Save dashboard to file
 */
export async function saveLearningProgressDashboard(
  dashboard: LearningProgressDashboard
): Promise<void> {
  try {
    await artifactWriter.writeJson("dashboards/learning-progress.json", dashboard);
  } catch (error) {
    throw new Error(
      `Failed to save dashboard: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load latest dashboard from file
 */
export async function loadLearningProgressDashboard(): Promise<LearningProgressDashboard | null> {
  try {
    const content = await fsPromises.readFile(DASHBOARD_PATH, "utf-8");
    return JSON.parse(content) as LearningProgressDashboard;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to load dashboard: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate and save dashboard (convenience function)
 */
export async function updateLearningProgressDashboard(reportingHours: number = 24): Promise<void> {
  const dashboard = await generateLearningProgressDashboard(reportingHours);
  await saveLearningProgressDashboard(dashboard);
}

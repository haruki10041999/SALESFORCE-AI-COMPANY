/**
 * Staged adoption mechanism for tool proposals
 * Implements: Shadow execution → Canary rollout → Auto-rollback
 */

import { promises as fsPromises } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { loadAllRewards } from "./reward-aggregator.js";

export type AdoptionStage = "shadow" | "canary" | "stable" | "rolling-back" | "rolled-back";

export interface StagedToolProposal {
  /** Unique proposal ID */
  proposalId: string;
  /** Tool name */
  toolName: string;
  /** Current adoption stage */
  stage: AdoptionStage;
  /** Version identifier */
  version: string;
  /** Previous version for rollback */
  previousVersion?: string;
  /** When proposal was created */
  createdAt: string;
  /** Stage transition history */
  stageHistory: Array<{
    stage: AdoptionStage;
    timestamp: string;
    reason?: string;
  }>;
  /** Shadow execution config */
  shadowConfig?: {
    enabled: boolean;
    compareWithVersion?: string;
    maxExecutions?: number;
    executionCount: number;
  };
  /** Canary config */
  canaryConfig?: {
    enabled: boolean;
    trafficPercentage: number; // 0-100
    minExecutions: number;
    executionCount: number;
    maxDuration: number; // hours
    startedAt?: string;
  };
  /** Stability metrics */
  metrics?: {
    avgRewardShadow?: number;
    avgRewardCanary?: number;
    errorRateShadow?: number;
    errorRateCanary?: number;
    successRateCanary?: number;
  };
  /** Rollback config */
  rollbackConfig?: {
    enabled: boolean;
    rewardDegradationThreshold?: number; // e.g., -0.15 = 15% drop
    errorRateThreshold?: number; // e.g., 0.1 = 10%
    autoExecute: boolean;
  };
}

const STAGED_PROPOSALS_PATH = resolve("outputs", "learning", "staged-proposals.jsonl");

/**
 * Ensure outputs/learning directory exists
 */
async function ensureLearningDir(): Promise<void> {
  try {
    await fsPromises.mkdir(resolve("outputs", "learning"), { recursive: true });
  } catch {
    // directory already exists
  }
}

/**
 * Create a new staged proposal starting with shadow execution
 */
export async function createStagedProposal(
  toolName: string,
  version: string,
  shadowCompareWith?: string
): Promise<StagedToolProposal> {
  await ensureLearningDir();

  const proposal: StagedToolProposal = {
    proposalId: randomUUID(),
    toolName,
    stage: "shadow",
    version,
      previousVersion: shadowCompareWith,
    createdAt: new Date().toISOString(),
    stageHistory: [
      {
        stage: "shadow",
        timestamp: new Date().toISOString(),
        reason: "Initial shadow execution phase"
      }
    ],
    shadowConfig: {
      enabled: true,
      compareWithVersion: shadowCompareWith,
      maxExecutions: 100,
      executionCount: 0
    },
    canaryConfig: undefined,
    rollbackConfig: {
      enabled: true,
      rewardDegradationThreshold: -0.15,
      errorRateThreshold: 0.1,
      autoExecute: false
    }
  };

  try {
    await fsPromises.appendFile(STAGED_PROPOSALS_PATH, JSON.stringify(proposal) + "\n");
  } catch (error) {
    throw new Error(
      `Failed to create staged proposal: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return proposal;
}

/**
 * Load all staged proposals
 */
export async function loadStagedProposals(): Promise<StagedToolProposal[]> {
  try {
    const content = await fsPromises.readFile(STAGED_PROPOSALS_PATH, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StagedToolProposal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(
      `Failed to load staged proposals: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Update staged proposal to next stage
 */
export async function transitionProposalStage(
  proposalId: string,
  nextStage: AdoptionStage,
  reason?: string
): Promise<StagedToolProposal | null> {
  const proposals = await loadStagedProposals();
  const proposal = proposals.find((p) => p.proposalId === proposalId);

  if (!proposal) {
    return null;
  }

  proposal.stage = nextStage;
  proposal.stageHistory.push({
    stage: nextStage,
    timestamp: new Date().toISOString(),
    reason
  });

  // Initialize canary config if transitioning to canary
  if (nextStage === "canary" && !proposal.canaryConfig) {
    proposal.canaryConfig = {
      enabled: true,
      trafficPercentage: 10, // Start at 10% traffic
      minExecutions: 50,
      executionCount: 0,
      maxDuration: 24,
      startedAt: new Date().toISOString()
    };
  }

  // Save updated proposals
  const updatedContent = proposals.map((p) => JSON.stringify(p)).join("\n") + "\n";
  try {
    await fsPromises.writeFile(STAGED_PROPOSALS_PATH, updatedContent);
  } catch (error) {
    throw new Error(
      `Failed to update staged proposal: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return proposal;
}

/**
 * Evaluate shadow execution results
 * Returns true if ready to move to canary
 */
export async function evaluateShadowExecution(
  proposalId: string
): Promise<{
  ready: boolean;
  reason: string;
  metrics: {
    executionCount: number;
    avgReward: number;
    errorRate: number;
  };
}> {
  const proposals = await loadStagedProposals();
  const proposal = proposals.find((p) => p.proposalId === proposalId);

  if (!proposal || proposal.stage !== "shadow") {
    return {
      ready: false,
      reason: "Proposal not found or not in shadow stage",
      metrics: { executionCount: 0, avgReward: 0, errorRate: 0 }
    };
  }

  // Collect rewards for this proposal's tool in shadow stage
  const allRewards = await loadAllRewards();
  const shadowRewards = allRewards.filter(
    (r) => r.toolName === proposal.toolName && r.tags?.includes("stage:shadow")
  );

  const executionCount = proposal.shadowConfig?.executionCount ?? 0;
  const avgReward = shadowRewards.length > 0
    ? shadowRewards.reduce((sum, r) => sum + r.reward, 0) / shadowRewards.length
    : 0;

  const errorCount = shadowRewards.filter((r) => r.reward < -0.3).length;
  const errorRate = shadowRewards.length > 0 ? errorCount / shadowRewards.length : 0;

  // Ready if: execution count >= minExecutions AND avgReward > 0 AND errorRate < 5%
  const minExecutions = proposal.shadowConfig?.maxExecutions ?? 100;
  const ready = executionCount >= Math.min(50, minExecutions * 0.5) && avgReward > 0 && errorRate < 0.05;

  return {
    ready,
    reason: ready
      ? "Shadow execution passed quality gates"
      : `Not ready: executions=${executionCount}, avgReward=${avgReward.toFixed(2)}, errorRate=${(errorRate * 100).toFixed(1)}%`,
    metrics: { executionCount, avgReward, errorRate }
  };
}

/**
 * Evaluate canary rollout
 * Returns true if ready for stable (full) deployment
 */
export async function evaluateCanaryRollout(
  proposalId: string
): Promise<{
  ready: boolean;
  reason: string;
  metrics: {
    executionCount: number;
    avgReward: number;
    successRate: number;
    durationHours: number;
  };
}> {
  const proposals = await loadStagedProposals();
  const proposal = proposals.find((p) => p.proposalId === proposalId);

  if (!proposal || proposal.stage !== "canary") {
    return {
      ready: false,
      reason: "Proposal not found or not in canary stage",
      metrics: { executionCount: 0, avgReward: 0, successRate: 0, durationHours: 0 }
    };
  }

  const startedAt = proposal.canaryConfig?.startedAt ? new Date(proposal.canaryConfig.startedAt) : new Date();
  const durationHours = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);

  // Collect rewards for this proposal's tool in canary stage
  const allRewards = await loadAllRewards();
  const canaryRewards = allRewards.filter(
    (r) => r.toolName === proposal.toolName && r.tags?.includes("stage:canary")
  );

  const executionCount = proposal.canaryConfig?.executionCount ?? 0;
  const avgReward = canaryRewards.length > 0
    ? canaryRewards.reduce((sum, r) => sum + r.reward, 0) / canaryRewards.length
    : 0;

  const successRate = canaryRewards.length > 0
    ? canaryRewards.filter((r) => r.reward > 0.2).length / canaryRewards.length
    : 0;

  // Ready if: minExecutions AND successRate >= 80% AND avgReward >= 0
  const minExecutions = proposal.canaryConfig?.minExecutions ?? 50;
  const ready = executionCount >= minExecutions && successRate >= 0.8 && avgReward >= 0;

  return {
    ready,
    reason: ready
      ? "Canary rollout passed quality gates - ready for stable deployment"
      : `Not ready: executions=${executionCount}/${minExecutions}, successRate=${(successRate * 100).toFixed(1)}%, avgReward=${avgReward.toFixed(2)}`,
    metrics: { executionCount, avgReward, successRate, durationHours }
  };
}

/**
 * Check if rollback should be triggered
 */
export async function shouldTriggerRollback(
  proposalId: string
): Promise<{
  shouldRollback: boolean;
  reason: string;
  metrics: {
    rewardDegradation: number;
    errorRate: number;
  };
}> {
  const proposals = await loadStagedProposals();
  const proposal = proposals.find((p) => p.proposalId === proposalId);

  if (!proposal || !proposal.rollbackConfig?.enabled) {
    return {
      shouldRollback: false,
      reason: "Rollback not applicable",
      metrics: { rewardDegradation: 0, errorRate: 0 }
    };
  }

  // Compare current version rewards with previous version
  const allRewards = await loadAllRewards();
  const currentRewards = allRewards.filter((r) => r.toolName === proposal.toolName);

  if (currentRewards.length < 20) {
    return {
      shouldRollback: false,
      reason: "Insufficient data for rollback decision",
      metrics: { rewardDegradation: 0, errorRate: 0 }
    };
  }

  // Recent vs older rewards
  const recentRewards = currentRewards.slice(-20);
  const olderRewards = currentRewards.slice(-40, -20);

  const recentAvg = recentRewards.reduce((sum, r) => sum + r.reward, 0) / recentRewards.length;
  const olderAvg = olderRewards.length > 0
    ? olderRewards.reduce((sum, r) => sum + r.reward, 0) / olderRewards.length
    : 0;

  const rewardDegradation = recentAvg - olderAvg;
  const errorRate = recentRewards.filter((r) => r.reward < -0.3).length / recentRewards.length;

  const threshold = proposal.rollbackConfig?.rewardDegradationThreshold ?? -0.15;
  const errorThreshold = proposal.rollbackConfig?.errorRateThreshold ?? 0.1;

  const shouldRollback = rewardDegradation < threshold || errorRate > errorThreshold;

  return {
    shouldRollback,
    reason: shouldRollback
      ? `Rollback triggered: reward_degradation=${rewardDegradation.toFixed(3)}, error_rate=${(errorRate * 100).toFixed(1)}%`
      : "Within acceptable thresholds",
    metrics: { rewardDegradation, errorRate }
  };
}

/**
 * Execute rollback to previous version
 */
export async function executeRollback(proposalId: string): Promise<StagedToolProposal | null> {
  const proposals = await loadStagedProposals();
  const proposal = proposals.find((p) => p.proposalId === proposalId);

  if (!proposal || !proposal.previousVersion) {
    return null;
  }

  proposal.stage = "rolled-back";
  proposal.stageHistory.push({
    stage: "rolled-back",
    timestamp: new Date().toISOString(),
    reason: `Rolled back to version ${proposal.previousVersion} due to quality degradation`
  });

  // Save updated proposals
  const updatedContent = proposals.map((p) => JSON.stringify(p)).join("\n") + "\n";
  try {
    await fsPromises.writeFile(STAGED_PROPOSALS_PATH, updatedContent);
  } catch (error) {
    throw new Error(
      `Failed to execute rollback: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return proposal;
}

/**
 * Get adoption stage summary
 */
export async function getAdoptionSummary(): Promise<{
  byStage: Record<AdoptionStage, number>;
  totalProposals: number;
  successRate: number;
}> {
  const proposals = await loadStagedProposals();

  const byStage: Record<AdoptionStage, number> = {
    shadow: 0,
    canary: 0,
    stable: 0,
    "rolling-back": 0,
    "rolled-back": 0
  };

  for (const proposal of proposals) {
    byStage[proposal.stage]++;
  }

  const stableCount = byStage.stable;
  const totalProposals = proposals.length;
  const successRate = totalProposals > 0 ? stableCount / totalProposals : 0;

  return {
    byStage,
    totalProposals,
    successRate
  };
}

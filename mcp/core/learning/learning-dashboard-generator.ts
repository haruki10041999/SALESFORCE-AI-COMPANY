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
  ErrorRecoveryMetrics,
  KnowledgeGraphMetrics
} from "../types/learning-dashboard.js";
import { getRewardStats } from "./reward-aggregator.js";
import { loadAgentReputationRecords } from "./agent-reputation.js";
import { getRewardHealth } from "./feedback-manager.js";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import { getOutputsDir } from "../config/runtime-config.js";
import { listProposals, summarizeProposalQueue } from "../resource/proposal/queue.js";
import { withContextOutputsPort } from "../runtime/with-context.js";

const DASHBOARD_PATH = resolve("outputs", "dashboards", "learning-progress.json");
const SELF_REFINE_RUNS_PATH = resolve("outputs", "learning", "critic-runs.jsonl");
const outputsPort = withContextOutputsPort(new LocalOutputsAdapter({ outputsDir: resolve(getOutputsDir()) }));

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
 * Compute proposal metrics from the persisted proposal queue.
 */
async function computeProposalMetrics(): Promise<ProposalMetrics | undefined> {
  try {
    const outputsDir = resolve(getOutputsDir());
    const summary = summarizeProposalQueue(outputsDir);
    const proposals = listProposals(outputsDir, { limit: 5000 });

    const now = Date.now();
    const pastWeekMs = 7 * 24 * 60 * 60 * 1000;

    const approvedDurationsMs = proposals
      .filter((proposal) => proposal.status === "approved" && proposal.resolvedAt)
      .map((proposal) => {
        const createdAtMs = Date.parse(proposal.createdAt);
        const resolvedAtMs = Date.parse(proposal.resolvedAt ?? "");
        return Number.isFinite(createdAtMs) && Number.isFinite(resolvedAtMs)
          ? Math.max(0, resolvedAtMs - createdAtMs)
          : 0;
      })
      .filter((value) => value > 0);

    const createdPastWeek = proposals.filter((proposal) => now - Date.parse(proposal.createdAt) <= pastWeekMs).length;
    const approvedPastWeek = proposals.filter((proposal) => {
      const resolvedAtMs = Date.parse(proposal.resolvedAt ?? "");
      return proposal.status === "approved" && Number.isFinite(resolvedAtMs) && now - resolvedAtMs <= pastWeekMs;
    }).length;

    const totalProposals = summary.pending + summary.approved + summary.rejected;
    if (totalProposals === 0) {
      return undefined;
    }

    return {
      totalProposals,
      approvedCount: summary.approved,
      rejectedCount: summary.rejected,
      pendingCount: summary.pending,
      adoptionRate: totalProposals > 0 ? summary.approved / totalProposals : 0,
      avgTimeToApproval:
        approvedDurationsMs.length > 0
          ? approvedDurationsMs.reduce((sum, value) => sum + value, 0) / approvedDurationsMs.length / 3_600_000
          : 0,
      byType: {
        skill: {
          total: summary.byResourceType.skills.pending + summary.byResourceType.skills.approved + summary.byResourceType.skills.rejected,
          approved: summary.byResourceType.skills.approved
        },
        tool: {
          total: summary.byResourceType.tools.pending + summary.byResourceType.tools.approved + summary.byResourceType.tools.rejected,
          approved: summary.byResourceType.tools.approved
        },
        preset: {
          total: summary.byResourceType.presets.pending + summary.byResourceType.presets.approved + summary.byResourceType.presets.rejected,
          approved: summary.byResourceType.presets.approved
        }
      },
      recentTrend: {
        proposalsCreatedPastWeek: createdPastWeek,
        proposalsApprovedPastWeek: approvedPastWeek
      },
      snapshotTime: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

/**
 * Compute self-refine metrics (stub)
 */
async function computeSelfRefineMetrics(): Promise<SelfRefineMetrics | undefined> {
  try {
    const content = await fsPromises.readFile(SELF_REFINE_RUNS_PATH, "utf-8");
    const records = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as {
        iterations?: number;
        finalScore?: number;
        initialScore?: number;
        nextAction?: string;
        recordedAt?: string;
      });

    if (records.length === 0) {
      return undefined;
    }

    const iterations = records.map((record) => Math.max(0, Math.floor(record.iterations ?? 0)));
    const improvements = records.map((record) => Math.max(0, (record.finalScore ?? 0) - (record.initialScore ?? 0)));
    const convergedCount = records.filter((record) => (record.finalScore ?? 0) >= 8.5).length;

    return {
      avgIterations: iterations.reduce((sum, value) => sum + value, 0) / iterations.length,
      maxIterations: Math.max(...iterations),
      minIterations: Math.min(...iterations),
      convergenceRate: convergedCount / records.length,
      avgQualityImprovement: improvements.reduce((sum, value) => sum + value, 0) / improvements.length,
      totalSessions: records.length,
      windowHours: 24,
      snapshotTime: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
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
 * Compute Knowledge Graph community detection metrics (T-17 increment 2)
 */
async function computeKnowledgeGraphMetrics(hours: number = 24): Promise<KnowledgeGraphMetrics | undefined> {
  try {
    const { inferTransitiveRelations, detectCommunities } = await import("../memory/kg-reasoner.js");
    const { listKnowledgeEntities, listKnowledgeRelations } = await import("../../../memory/knowledge-graph.js");

    const entities = listKnowledgeEntities();
    const relations = listKnowledgeRelations();

    if (entities.length === 0 || relations.length === 0) {
      return undefined;
    }

    // Calculate average degree
    const degreeMap = new Map<string, number>();
    for (const rel of relations) {
      degreeMap.set(rel.srcId, (degreeMap.get(rel.srcId) ?? 0) + 1);
      degreeMap.set(rel.dstId, (degreeMap.get(rel.dstId) ?? 0) + 1);
    }
    const avgDegree = Array.from(degreeMap.values()).reduce((a, b) => a + b, 0) / Math.max(1, entities.length);

    // Detect communities
    const communities = detectCommunities(); // no minSize filter needed

    // Calculate transitive closure depths using inferred relations
    const inferred = inferTransitiveRelations({ maxDepth: 10 });
    const reachabilityMap = new Map<string, Set<string>>();
    
    for (const inf of inferred) {
      if (!reachabilityMap.has(inf.srcId)) {
        reachabilityMap.set(inf.srcId, new Set());
      }
      reachabilityMap.get(inf.srcId)!.add(inf.dstId);
    }

    let totalDepth = 0;
    let maxDepth = 0;
    for (const entity of entities) {
      const reachable = reachabilityMap.get(entity.id) ?? new Set();
      const depth = reachable.size;
      totalDepth += depth;
      maxDepth = Math.max(maxDepth, depth);
    }
    const avgTransitiveDepth = entities.length > 0 ? totalDepth / entities.length : 0;

    // Community metrics
    const communityMetrics = communities.map((c: typeof communities[0]) => ({
      communityId: c.communityId,
      memberCount: c.members.length,
      relationCount: c.relationCount,
      density: c.relationCount > 0 ? c.relationCount / (c.members.length * (c.members.length - 1) / 2) : 0
    }));

    // Hybrid retrieval hit rate (estimate: % of queries that benefited from KG)
    // In real implementation, would track query outcomes
    const hybridRetrievalHitRate = communities.length > 0 ? 0.65 : 0.3;

    return {
      totalEntities: entities.length,
      totalRelations: relations.length,
      avgDegree,
      communityCount: communities.length,
      communities: communityMetrics,
      avgTransitiveDepth: Math.round(avgTransitiveDepth * 100) / 100,
      maxTransitiveDepth: maxDepth,
      hybridRetrievalHitRate,
      windowHours: hours,
      snapshotTime: new Date().toISOString()
    };
  } catch (e) {
    // KG reasoner or knowledge graph not available
    return undefined;
  }
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
  const knowledgeGraphMetrics = await computeKnowledgeGraphMetrics(reportingHours);

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
    knowledgeGraphMetrics: knowledgeGraphMetrics || undefined,
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
    await outputsPort.writeArtifact("dashboards/learning-progress.json", `${JSON.stringify(dashboard, null, 2)}\n`, {
      contentType: "application/json"
    });
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

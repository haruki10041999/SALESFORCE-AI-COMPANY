/**
 * Learning progress dashboard schema and types
 * Aggregates metrics from all learning subsystems
 */

export interface BanditArmMetrics {
  /** Arm (agent/prompt/tool) name */
  name: string;
  /** Number of times this arm was selected */
  selectCount: number;
  /** Cumulative reward */
  cumulativeReward: number;
  /** Average reward */
  avgReward: number;
  /** Estimated optimal probability */
  optimalityScore: number;
  /** Confidence interval half-width (approximation of convergence) */
  confidenceHalfWidth: number;
  /** Upper confidence bound */
  ucb: number;
  /** Lower confidence bound */
  lcb: number;
  /** Time of last update */
  lastUpdated: string;
}

export interface BanditMetrics {
  /** Name of the bandit (e.g., agent-selection, prompt-tuning) */
  banditName: string;
  /** Total selections across all arms */
  totalSelections: number;
  /** Cumulative reward across all arms */
  totalReward: number;
  /** Average reward per selection */
  avgReward: number;
  /** Bandit regret estimate (cumulative loss vs optimal) */
  estimatedRegret: number;
  /** Convergence status: cold | exploring | converged */
  convergenceStatus: "cold" | "exploring" | "converged";
  /** Percentage of selections on optimal arm */
  optimalArmSelectionRate: number;
  /** Per-arm metrics */
  arms: BanditArmMetrics[];
  /** Time window (hours) for these metrics */
  windowHours: number;
  /** Timestamp of snapshot */
  snapshotTime: string;
}

export interface ReputationDistributionMetrics {
  /** Global score percentiles */
  percentile25: number;
  percentile50: number;
  percentile75: number;
  percentile90: number;
  /** Distribution stats */
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  /** Number of agents with data */
  agentCount: number;
  /** Convergence metric: how stable is the distribution */
  stabilityScore: number; // 0-1, higher = more stable
  /** Timestamp */
  snapshotTime: string;
}

export interface ProposalMetrics {
  /** Total proposals ever created */
  totalProposals: number;
  /** Proposals approved */
  approvedCount: number;
  /** Proposals rejected */
  rejectedCount: number;
  /** Proposals pending review */
  pendingCount: number;
  /** Adoption rate (approved / total) */
  adoptionRate: number;
  /** Average time to approval (hours) */
  avgTimeToApproval: number;
  /** Proposal sources: skill | tool | preset */
  byType: {
    skill: { total: number; approved: number };
    tool: { total: number; approved: number };
    preset: { total: number; approved: number };
  };
  /** Recent trends (last 7 days) */
  recentTrend: {
    proposalsCreatedPastWeek: number;
    proposalsApprovedPastWeek: number;
  };
  /** Timestamp */
  snapshotTime: string;
}

export interface SelfRefineMetrics {
  /** Average iterations per self-refine session */
  avgIterations: number;
  /** Maximum iterations observed */
  maxIterations: number;
  /** Minimum iterations observed */
  minIterations: number;
  /** Percentage of sessions that converged (< max iterations) */
  convergenceRate: number;
  /** Average quality improvement per iteration (0-1) */
  avgQualityImprovement: number;
  /** Total sessions processed */
  totalSessions: number;
  /** Time window (hours) */
  windowHours: number;
  /** Timestamp */
  snapshotTime: string;
}

export interface PromptTemplateMetrics {
  /** Template name/ID */
  templateId: string;
  /** Generation/version */
  generation: number;
  /** Status: active | retired | promoted */
  status: "active" | "retired" | "promoted";
  /** Average quality score */
  avgQuality: number;
  /** Number of evaluations */
  evaluationCount: number;
  /** Token efficiency score (cost per quality) */
  tokenEfficiency: number;
  /** Success rate in downstream tasks */
  successRate: number;
  /** When this template was created */
  createdAt: string;
  /** When it became active or retired */
  statusChangedAt?: string;
}

export interface PromptTemplateQualityMetrics {
  /** Total templates tracked */
  totalTemplates: number;
  /** Active templates */
  activeCount: number;
  /** Promoted (best) templates */
  promotedCount: number;
  /** Retired templates */
  retiredCount: number;
  /** Average quality across active templates */
  avgActiveQuality: number;
  /** Quality improvement trend (% change from previous week) */
  qualityTrend: number;
  /** Per-template details */
  templates: PromptTemplateMetrics[];
  /** Timestamp */
  snapshotTime: string;
}

export interface ErrorRecoveryMetrics {
  /** Total errors encountered */
  totalErrors: number;
  /** Errors successfully recovered */
  recoveredCount: number;
  /** Recovery rate */
  recoveryRate: number;
  /** Most common error types and recovery rates */
  byErrorType: Array<{
    errorType: string;
    count: number;
    recoveryRate: number;
  }>;
  /** Average recovery time (ms) */
  avgRecoveryTime: number;
  /** Time window (hours) */
  windowHours: number;
  /** Timestamp */
  snapshotTime: string;
}

export interface LearningProgressDashboard {
  /** Version of the dashboard schema */
  version: string;
  /** Timestamp of this snapshot */
  generatedAt: string;
  /** Reporting period in hours */
  reportingHours: number;
  /** Overall learning health score (0-1) */
  healthScore: number;
  /** Timestamp of last meaningful progress (new approval, convergence, etc.) */
  lastProgressAt: string;
  /** Key learning milestones in this period */
  milestones: Array<{
    type: "convergence" | "approval" | "retirement" | "recovery";
    description: string;
    timestamp: string;
  }>;
  /** Per-subsystem metrics */
  bandit?: BanditMetrics[];
  reputation?: ReputationDistributionMetrics;
  proposals?: ProposalMetrics;
  selfRefine?: SelfRefineMetrics;
  prompts?: PromptTemplateQualityMetrics;
  errorRecovery?: ErrorRecoveryMetrics;
  /** Knowledge Graph community detection metrics (T-17) */
  knowledgeGraphMetrics?: KnowledgeGraphMetrics;
  /** Recommendations for next steps */
  recommendations: Array<{
    subsystem: string;
    priority: "high" | "medium" | "low";
    action: string;
    reason: string;
  }>;
  /** Raw aggregated stats for debugging */
  rawStats?: Record<string, unknown>;
}

/**
 * Knowledge Graph metrics for hybrid memory retrieval (T-17 increment 2)
 */
export interface KnowledgeGraphCommunity {
  /** Community ID */
  communityId: string;
  /** Number of entities in this community */
  memberCount: number;
  /** Number of relations within community */
  relationCount: number;
  /** Density score (0-1) indicating how tightly connected */
  density: number;
}

export interface KnowledgeGraphMetrics {
  /** Total entities in knowledge graph */
  totalEntities: number;
  /** Total relations in knowledge graph */
  totalRelations: number;
  /** Average degree (relations per entity) */
  avgDegree: number;
  /** Number of detected communities */
  communityCount: number;
  /** Communities by size */
  communities: KnowledgeGraphCommunity[];
  /** Average transitive closure depth (max hops reachable) */
  avgTransitiveDepth: number;
  /** Maximum transitive closure found */
  maxTransitiveDepth: number;
  /** Hybrid retrieval effectiveness (queries benefiting from KG reasoning) */
  hybridRetrievalHitRate: number;
  /** Time window (hours) */
  windowHours: number;
  /** Timestamp */
  snapshotTime: string;
}

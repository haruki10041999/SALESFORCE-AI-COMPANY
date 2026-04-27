/**
 * Governance Manager
 * 
 * リソースガバナンス（使用数、バグシグナル、無効化状態など）を管理
 *
 * TASK-F11: configuration shape and defaults moved to `./defaults.ts`. This
 * file re-exports them so call sites and external imports stay stable.
 */
import {
  DEFAULT_GOVERNANCE_CONFIG as DEFAULTS_FROM_SOURCE,
  type GovernanceConfig as GovernanceConfigFromSource,
  type GovernanceMaxCounts,
  type GovernanceThresholds,
  type GovernanceResourceLimits
} from "./defaults.js";

export type ResourceType = "skills" | "tools" | "presets";

/**
 * リソーススコアリング（使用状況ベース）
 */
export interface ResourceScore {
  name: string;
  usage: number;
  bugSignals: number;
  score: number; // usage - (bugSignals * 3)
  riskLevel: "low" | "medium" | "high";
}

// Re-exports keep prior public surface intact.
export type GovernanceConfig = GovernanceConfigFromSource;
export type { GovernanceMaxCounts, GovernanceThresholds, GovernanceResourceLimits };

/**
 * デフォルトガバナンス設定
 *
 * 値の編集は `mcp/core/governance/defaults.ts` で行ってください。
 */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = DEFAULTS_FROM_SOURCE;

/**
 * リソースを記録した操作
 */
export interface ResourceOperation {
  type: "create" | "delete" | "disable" | "enable";
  resourceType: ResourceType;
  name: string;
  timestamp: string;
}

/**
 * 使用状況レコード
 */
export interface UsageRecord {
  [resourceType: string]: {
    [resourceName: string]: number;
  };
}

/**
 * バグシグナルレコード
 */
export interface BugSignalRecord {
  [resourceType: string]: {
    [resourceName: string]: number;
  };
}

/**
 * リソーススコアを計算
 */
export function calculateResourceScore(
  usage: number,
  bugSignals: number
): number {
  return usage - bugSignals * 3;
}

/**
 * リスクレベルを判定
 */
export function assessRiskLevel(
  usage: number,
  bugSignals: number
): "low" | "medium" | "high" {
  const score = calculateResourceScore(usage, bugSignals);

  if (bugSignals > 5) return "high";
  if (bugSignals > 2) return "medium";
  if (score < 0) return "high";
  if (score < 2) return "medium";
  return "low";
}

/**
 * 削除推奨判定
 */
export function shouldRecommendDeletion(
  usage: number,
  bugSignals: number,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG
): boolean {
  return (
    usage <= config.thresholds.minUsageToKeep &&
    bugSignals >= config.thresholds.bugSignalToFlag
  );
}

/**
 * 無効化推奨判定
 */
export function shouldRecommendDisable(
  usage: number,
  bugSignals: number,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG
): boolean {
  return (
    usage === 0 &&
    bugSignals >= config.thresholds.bugSignalToFlag * 2
  );
}

/**
 * 1日の操作数をチェック
 */
export function checkDailyLimitExceeded(
  operations: ResourceOperation[],
  operationType: "create" | "delete",
  limit: number,
  withinLastHours: number = 24
): boolean {
  const now = new Date();
  const cutoff = new Date(now.getTime() - withinLastHours * 60 * 60 * 1000);

  const recentOps = operations.filter(
    (op) =>
      op.type === operationType &&
      new Date(op.timestamp) > cutoff
  );

  return recentOps.length >= limit;
}

/**
 * リソース数が上限に達したかチェック
 */
export function isAtCapacity(
  resourceType: ResourceType,
  currentCount: number,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG
): boolean {
  return currentCount >= config.maxCounts[resourceType];
}

/**
 * リソース数が上限を超えたかチェック
 */
export function isOverCapacity(
  resourceType: ResourceType,
  currentCount: number,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG
): boolean {
  return currentCount > config.maxCounts[resourceType];
}

/**
 * 削除候補を提案
 */
export function suggestDeletionCandidates(
  resources: Map<string, { usage: number; bugSignals: number }>,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG,
  limit: number = 5
): ResourceScore[] {
  const candidates: ResourceScore[] = [];

  for (const [name, stats] of resources.entries()) {
    const score = calculateResourceScore(stats.usage, stats.bugSignals);
    const riskLevel = assessRiskLevel(stats.usage, stats.bugSignals);

    if (shouldRecommendDeletion(stats.usage, stats.bugSignals, config)) {
      candidates.push({
        name,
        usage: stats.usage,
        bugSignals: stats.bugSignals,
        score,
        riskLevel
      });
    }
  }

  // リスクレベル、スコア順でソート
  candidates.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.score - b.score;
  });

  return candidates.slice(0, limit);
}

/**
 * 無効化候補を提案
 */
export function suggestDisableCandidates(
  resources: Map<string, { usage: number; bugSignals: number }>,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG,
  limit: number = 5
): ResourceScore[] {
  const candidates: ResourceScore[] = [];

  for (const [name, stats] of resources.entries()) {
    const score = calculateResourceScore(stats.usage, stats.bugSignals);
    const riskLevel = assessRiskLevel(stats.usage, stats.bugSignals);

    if (shouldRecommendDisable(stats.usage, stats.bugSignals, config)) {
      candidates.push({
        name,
        usage: stats.usage,
        bugSignals: stats.bugSignals,
        score,
        riskLevel
      });
    }
  }

  candidates.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.score - b.score;
  });

  return candidates.slice(0, limit);
}

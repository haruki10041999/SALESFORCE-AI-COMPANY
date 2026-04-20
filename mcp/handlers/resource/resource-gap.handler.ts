/**
 * Resource Gap Handler
 * 
 * resource_gap_detected イベントに応答して自動的にリソースを提案・作成
 */

import type { GapDetectionResult } from "../../core/resource/resource-gap-detector.js";
import type { ResourceSuggestion } from "../../core/resource/resource-suggester.js";
import {
  suggestResource,
  normalizeResourceSuggestion
} from "../../core/resource/resource-suggester.js";
import {
  checkResourceQuality,
  type QualityCheckResult
} from "../../core/quality/quality-checker.js";
import {
  checkForDuplicates,
  type SimilarityCheckResult
} from "../../core/quality/deduplication.js";

/**
 * ハンドラー実行結果
 */
export interface HandlerExecutionResult {
  success: boolean;
  resourceGap: GapDetectionResult;
  suggestion: ResourceSuggestion | null;
  qualityCheck: QualityCheckResult | null;
  duplicateCheck: SimilarityCheckResult | null;
  applied: boolean;
  reason?: string;
}

/**
 * ハンドラー実行時の制御値
 */
export interface HandlerConfig {
  // 自動実行の有効化（false の場合は suggestion のみ返す）
  autoApply: boolean;

  // スコアの最低基準
  minimumScoreToApply: number; // 品質スコア

  // 重複判定の閾値
  duplicateSimilarityThreshold: number;

  // 1日の自動生成上限
  maxCreationsPerDay: number;

  // パッケージ化の対象最小スコア
  minScoreToPackage: number;
}

/**
 * デフォルトハンドラー設定
 */
export const DEFAULT_HANDLER_CONFIG: HandlerConfig = {
  autoApply: false, // 初期は提案のみ
  minimumScoreToApply: 70,
  duplicateSimilarityThreshold: 0.8,
  maxCreationsPerDay: 5,
  minScoreToPackage: 60
};

/**
 * リソースギャップハンドラー
 */
export async function handleResourceGapDetected(
  gap: GapDetectionResult,
  existingResources: Array<{
    name: string;
    description?: string;
    summary?: string;
  }> = [],
  config: HandlerConfig = DEFAULT_HANDLER_CONFIG
): Promise<HandlerExecutionResult> {
  // ステップ1: 提案を生成
  const suggestion = suggestResource(gap);
  const normalizedSuggestion = normalizeResourceSuggestion(suggestion);

  // ステップ2: 品質チェック
  const resourceForQualityCheck = {
    name: normalizedSuggestion.name,
    description: normalizedSuggestion.description,
    title: normalizedSuggestion.title
  };
  const qualityCheck = checkResourceQuality(
    gap.resourceType,
    resourceForQualityCheck as Record<string, unknown>
  );

  // ステップ3: 重複チェック
  const duplicateCheck = checkForDuplicates(
    {
      name: normalizedSuggestion.name,
      description: normalizedSuggestion.description,
      summary: normalizedSuggestion.description
    },
    existingResources,
    config.duplicateSimilarityThreshold
  );

  // ステップ4: 適用可否を判定
  const canApply =
    qualityCheck.pass &&
    !duplicateCheck.isDuplicate &&
    qualityCheck.score >= config.minimumScoreToApply;

  const applied = config.autoApply && canApply;
  let reason: string | undefined;

  if (!applied) {
    if (!qualityCheck.pass) {
      reason = "品質チェック不合格";
    } else if (duplicateCheck.isDuplicate) {
      reason = `重複検出（類似度: ${(duplicateCheck.similarity * 100).toFixed(1)}%）`;
    } else if (qualityCheck.score < config.minimumScoreToApply) {
      reason = `品質スコア不足（${qualityCheck.score}/100）`;
    }
  }

  return {
    success: applied,
    resourceGap: gap,
    suggestion: normalizedSuggestion,
    qualityCheck,
    duplicateCheck,
    applied,
    reason
  };
}

/**
 * 複数のギャップに対してハンドラーを実行
 */
export async function handleMultipleGaps(
  gaps: GapDetectionResult[],
  existingResources: Map<
    string,
    Array<{
      name: string;
      description?: string;
      summary?: string;
    }>
  > = new Map(),
  config: HandlerConfig = DEFAULT_HANDLER_CONFIG
): Promise<HandlerExecutionResult[]> {
  const results: HandlerExecutionResult[] = [];

  for (const gap of gaps) {
    if (!gap.detected) continue;

    const resourcesForType = existingResources.get(gap.resourceType) ?? [];
    const result = await handleResourceGapDetected(
      gap,
      resourcesForType,
      config
    );
    results.push(result);
  }

  return results;
}

/**
 * ハンドラーの実行統計
 */
export function summarizeResults(
  results: HandlerExecutionResult[]
): {
  totalGaps: number;
  applied: number;
  failed: number;
  suggestions: ResourceSuggestion[];
} {
  return {
    totalGaps: results.length,
    applied: results.filter((r) => r.applied).length,
    failed: results.filter((r) => !r.success && !r.applied).length,
    suggestions: results
      .map((r) => r.suggestion)
      .filter((s): s is ResourceSuggestion => s !== null)
  };
}

/**
 * Governance Threshold Handler
 * 
 * governance_threshold_exceeded イベントに応答して自動削除・無効化を実行
 */

import {
  isOverCapacity,
  suggestDeletionCandidates,
  suggestDisableCandidates,
  type ResourceScore
} from "../../core/governance/governance-manager.js";

/**
 * ハンドラー実行結果
 */
export interface ThresholdHandlerResult {
  success: boolean;
  resourceType: "skills" | "tools" | "presets";
  countBefore: number;
  countAfter: number;
  deleted: string[];
  disabled: string[];
  deletionFailures: string[];
  disableFailures: string[];
  appliedCount: number;
}

/**
 * ハンドラー実行設定
 */
export interface ThresholdHandlerConfig {
  // 自動実行の有効化
  autoApply: boolean;

  // 削除優先か無効化優先か
  preferDeletion: boolean; // true=削除優先, false=無効化優先

  // 一度の実行で削除する最大数
  maxDeletionsPerRun: number;

  // ビルトインツールは削除不可（無効化のみ）
  protectBuiltinTools: boolean;
}

/**
 * デフォルト設定
 */
export const DEFAULT_THRESHOLD_CONFIG: ThresholdHandlerConfig = {
  autoApply: false, // 初期は提案のみ
  preferDeletion: false, // 無効化優先（安全）
  maxDeletionsPerRun: 3,
  protectBuiltinTools: true
};

/**
 * ガバナンス閾値超過時のハンドラー
 */
export async function handleGovernanceThresholdExceeded(
  resourceType: "skills" | "tools" | "presets",
  currentCount: number,
  maxCount: number,
  candidates: ResourceScore[],
  config: ThresholdHandlerConfig = DEFAULT_THRESHOLD_CONFIG,
  deleteFn?: (name: string) => Promise<boolean>,
  disableFn?: (name: string) => Promise<boolean>
): Promise<ThresholdHandlerResult> {
  const deleted: string[] = [];
  const disabled: string[] = [];
  const deletionFailures: string[] = [];
  const disableFailures: string[] = [];

  // オーバーキャパシティチェック
  const isOver = isOverCapacity(resourceType, currentCount);
  if (!isOver) {
    return {
      success: true,
      resourceType,
      countBefore: currentCount,
      countAfter: currentCount,
      deleted: [],
      disabled: [],
      deletionFailures: [],
      disableFailures: [],
      appliedCount: 0
    };
  }

  // 削除する数を計算
  const needsReduction = currentCount - maxCount;
  let toProcess = [...candidates].slice(0, needsReduction + 1);

  // 優先順位に基づいて処理方法を決定
  for (const candidate of toProcess) {
    if (
      deleted.length + disabled.length >=
      config.maxDeletionsPerRun
    ) {
      break;
    }

    if (config.preferDeletion && deleted.length < needsReduction) {
      // 削除を試みる
      if (deleteFn) {
        try {
          const success = await deleteFn(candidate.name);
          if (success) {
            deleted.push(candidate.name);
          } else {
            deletionFailures.push(candidate.name);
            // 失敗時は無効化を試みる
            if (disableFn) {
              const disableSuccess = await disableFn(candidate.name);
              if (disableSuccess) {
                disabled.push(candidate.name);
              } else {
                disableFailures.push(candidate.name);
              }
            }
          }
        } catch (err) {
          deletionFailures.push(candidate.name);
        }
      }
    } else {
      // 無効化を試みる
      if (disableFn) {
        try {
          const success = await disableFn(candidate.name);
          if (success) {
            disabled.push(candidate.name);
          } else {
            disableFailures.push(candidate.name);
            // 失敗時は削除を試みる
            if (deleteFn) {
              const deleteSuccess = await deleteFn(candidate.name);
              if (deleteSuccess) {
                deleted.push(candidate.name);
              } else {
                deletionFailures.push(candidate.name);
              }
            }
          }
        } catch (err) {
          disableFailures.push(candidate.name);
        }
      }
    }
  }

  const countAfter = currentCount - deleted.length;
  const applied = deleted.length + disabled.length;

  return {
    success: countAfter <= maxCount,
    resourceType,
    countBefore: currentCount,
    countAfter,
    deleted,
    disabled,
    deletionFailures,
    disableFailures,
    appliedCount: applied
  };
}

/**
 * エラーアグリゲートハンドラー
 * （バグシグナル集約時に該当ツールを無効化）
 */
export async function handleErrorAggregateDetected(
  toolName: string,
  errorCount: number,
  threshold: number = 3,
  disableFn?: (name: string) => Promise<boolean>
): Promise<{
  success: boolean;
  toolName: string;
  disabled: boolean;
  reason: string;
}> {
  if (errorCount < threshold) {
    return {
      success: true,
      toolName,
      disabled: false,
      reason: "エラー数が閾値以下"
    };
  }

  if (!disableFn) {
    return {
      success: false,
      toolName,
      disabled: false,
      reason: "disable 関数が提供されていない"
    };
  }

  try {
    const disabled = await disableFn(toolName);
    return {
      success: disabled,
      toolName,
      disabled,
      reason: disabled
        ? `エラー集約（${errorCount}/${threshold}）により無効化`
        : "無効化に失敗"
    };
  } catch (err) {
    return {
      success: false,
      toolName,
      disabled: false,
      reason: `エラー: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * 複数のリソースタイプ対してハンドラーを実行
 */
export async function handleGovernanceMultiple(
  resources: {
    type: "skills" | "tools" | "presets";
    currentCount: number;
    maxCount: number;
    candidates: ResourceScore[];
  }[],
  config: ThresholdHandlerConfig = DEFAULT_THRESHOLD_CONFIG,
  deleteFn?: (type: string, name: string) => Promise<boolean>,
  disableFn?: (type: string, name: string) => Promise<boolean>
): Promise<ThresholdHandlerResult[]> {
  const results: ThresholdHandlerResult[] = [];

  for (const resource of resources) {
    const result = await handleGovernanceThresholdExceeded(
      resource.type,
      resource.currentCount,
      resource.maxCount,
      resource.candidates,
      config,
      deleteFn ? (name) => deleteFn(resource.type, name) : undefined,
      disableFn ? (name) => disableFn(resource.type, name) : undefined
    );
    results.push(result);
  }

  return results;
}

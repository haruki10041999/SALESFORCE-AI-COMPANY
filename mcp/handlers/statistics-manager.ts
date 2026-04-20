/**
 * Handlers Statistics Manager
 * 
 * すべてのハンドラートラッカーを統合管理
 */

import type { CreatedResourceTracker } from "./resource/resource-created.handler.js";
import type { DeletedResourceTracker } from "./resource/resource-deleted.handler.js";
import type { ErrorAggregateTracker } from "./governance/error-aggregate.handler.js";
import type { QualityCheckFailureTracker } from "./governance/quality-check-failed.handler.js";

import {
  initializeCreatedResourceTracker
} from "./resource/resource-created.handler.js";
import {
  initializeDeletedResourceTracker
} from "./resource/resource-deleted.handler.js";
import {
  initializeErrorAggregateTracker
} from "./governance/error-aggregate.handler.js";
import {
  initializeQualityCheckFailureTracker
} from "./governance/quality-check-failed.handler.js";

/**
 * ハンドラー統計の総合管理オブジェクト
 */
export interface HandlersStatistics {
  created: CreatedResourceTracker;
  deleted: DeletedResourceTracker;
  errors: ErrorAggregateTracker;
  qualityFailures: QualityCheckFailureTracker;
  lastUpdated: string;
}

/**
 * ハンドラー統計を初期化
 */
export function initializeHandlersStatistics(): HandlersStatistics {
  return {
    created: initializeCreatedResourceTracker(),
    deleted: initializeDeletedResourceTracker(),
    errors: initializeErrorAggregateTracker(),
    qualityFailures: initializeQualityCheckFailureTracker(),
    lastUpdated: new Date().toISOString()
  };
}

/**
 * 統計サマリーを生成
 */
export function generateHandlersStatisticsSummary(
  stats: HandlersStatistics
): {
  resourceLifecycle: {
    created: number;
    deleted: number;
    active: number;
  };
  errors: {
    totalErrors: number;
    toolsWithErrors: number;
  };
  quality: {
    failureCount: number;
    mostFailedResource?: string;
  };
  trends: {
    creationTrend: string;
    deletionTrend: string;
    errorTrend: string;
  };
  lastUpdated: string;
} {
  const createdCount = stats.created.totalCreated;
  const deletedCount = stats.deleted.deletedResources.length;
  const activeCount = Math.max(0, createdCount - deletedCount);

  // 最も失敗が多いリソースを特定
  let mostFailedResource: string | undefined;
  let maxFailures = 0;
  for (const [resource, count] of stats.qualityFailures.failuresByResource.entries()) {
    if (count > maxFailures) {
      maxFailures = count;
      mostFailedResource = resource;
    }
  }

  return {
    resourceLifecycle: {
      created: createdCount,
      deleted: deletedCount,
      active: activeCount
    },
    errors: {
      totalErrors: stats.errors.toolErrors.size > 0
        ? Array.from(stats.errors.toolErrors.values()).reduce((sum, t) => sum + t.errorCount, 0)
        : 0,
      toolsWithErrors: stats.errors.toolErrors.size
    },
    quality: {
      failureCount: stats.qualityFailures.failures.length,
      mostFailedResource
    },
    trends: {
      creationTrend: "monitoring",
      deletionTrend: "monitoring",
      errorTrend: "monitoring"
    },
    lastUpdated: stats.lastUpdated
  };
}

/**
 * 統計をCSV形式でエクスポート
 */
export function exportStatisticsAsCsv(
  stats: HandlersStatistics
): string {
  const rows: string[] = [];

  // ヘッダー
  rows.push("リソース作成統計");
  rows.push("リソースタイプ,数");
  for (const [type, count] of Object.entries(stats.created.createdByType)) {
    rows.push(`${type},${count}`);
  }

  rows.push("");
  rows.push("リソース削除統計");
  rows.push("リソースタイプ,数");
  for (const [type, count] of Object.entries(stats.deleted.deletedByType)) {
    rows.push(`${type},${count}`);
  }

  rows.push("");
  rows.push("エラーハンドラー統計");
  rows.push("ツール,エラー数");
  for (const [toolName, record] of stats.errors.toolErrors.entries()) {
    rows.push(`${toolName},${record.errorCount}`);
  }

  rows.push("");
  rows.push("品質チェック失敗統計");
  rows.push("リソースタイプ,失敗数");
  for (const [type, count] of Object.entries(stats.qualityFailures.failuresByType)) {
    rows.push(`${type},${count}`);
  }

  return rows.join("\n");
}

/**
 * 統計をJSON形式でエクスポート
 */
export function exportStatisticsAsJson(
  stats: HandlersStatistics
): string {
  const summary = generateHandlersStatisticsSummary(stats);

  return JSON.stringify(
    {
      summary,
      detailed: {
        created: {
          total: stats.created.totalCreated,
          byType: stats.created.createdByType,
          bySource: stats.created.createdBySource
        },
        deleted: {
          total: stats.deleted.deletedResources.length,
          byType: stats.deleted.deletedByType
        },
        errors: {
          totalTools: stats.errors.toolErrors.size,
          totalErrors: Array.from(stats.errors.toolErrors.values()).reduce(
            (sum, t) => sum + t.errorCount,
            0
          )
        },
        qualityFailures: {
          total: stats.qualityFailures.failures.length,
          byType: stats.qualityFailures.failuresByType
        }
      },
      timestamp: new Date().toISOString()
    },
    null,
    2
  );
}

/**
 * 統計を更新タイムスタンプ付きで返す
 */
export function updateStatisticsTimestamp(
  stats: HandlersStatistics
): HandlersStatistics {
  return {
    ...stats,
    lastUpdated: new Date().toISOString()
  };
}

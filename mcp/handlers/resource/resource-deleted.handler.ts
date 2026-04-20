/**
 * Resource Deleted Handler
 * 
 * resource_deleted イベントに応答して削除統計を更新
 */

export interface DeletedResourceRecord {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  timestamp: string;
  reason?: string;
}

export interface DeletedResourceTracker {
  deletedResources: DeletedResourceRecord[];
  deletedByType: Record<"skills" | "tools" | "presets", number>;
  deletionHistory: Array<{
    date: string;
    count: number;
  }>;
}

/**
 * 削除リソーストラッカーを初期化
 */
export function initializeDeletedResourceTracker(): DeletedResourceTracker {
  return {
    deletedResources: [],
    deletedByType: {
      skills: 0,
      tools: 0,
      presets: 0
    },
    deletionHistory: []
  };
}

/**
 * リソース削除を記録
 */
export function recordResourceDeletion(
  tracker: DeletedResourceTracker,
  resourceType: "skills" | "tools" | "presets",
  name: string,
  reason?: string
): DeletedResourceRecord {
  const now = new Date();
  const record: DeletedResourceRecord = {
    resourceType,
    name,
    timestamp: now.toISOString(),
    reason
  };

  tracker.deletedResources.push(record);
  tracker.deletedByType[resourceType]++;

  // 日単位の履歴を更新
  const today = now.toISOString().split("T")[0];
  const historyEntry = tracker.deletionHistory.find((h) => h.date === today);
  if (historyEntry) {
    historyEntry.count++;
  } else {
    tracker.deletionHistory.push({ date: today, count: 1 });
  }

  // リソースリストは最大100件
  if (tracker.deletedResources.length > 100) {
    tracker.deletedResources.shift();
  }

  return record;
}

/**
 * リソースタイプ別の削除数を取得
 */
export function getDeletionCountByType(
  tracker: DeletedResourceTracker,
  resourceType: "skills" | "tools" | "presets"
): number {
  return tracker.deletedByType[resourceType];
}

/**
 * 特定の日の削除数を取得
 */
export function getDeletionCountForDate(
  tracker: DeletedResourceTracker,
  date: string // "YYYY-MM-DD"
): number {
  return tracker.deletionHistory.find((h) => h.date === date)?.count ?? 0;
}

/**
 * 最近削除されたリソースを取得
 */
export function getRecentlyDeletedResources(
  tracker: DeletedResourceTracker,
  limit: number = 10
): DeletedResourceRecord[] {
  return tracker.deletedResources.slice(-limit).reverse();
}

/**
 * 削除パターンを検出
 */
export function detectDeletionPatterns(
  tracker: DeletedResourceTracker,
  withinLastDays: number = 7
): {
  totalDeletedInPeriod: number;
  averageDeletionsPerDay: number;
  deletionTrend: "increasing" | "decreasing" | "stable";
  byType: Record<"skills" | "tools" | "presets", number>;
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinLastDays);

  let totalInPeriod = 0;
  const byType: Record<"skills" | "tools" | "presets", number> = {
    skills: 0,
    tools: 0,
    presets: 0
  };

  for (const deletion of tracker.deletedResources) {
    if (new Date(deletion.timestamp) > cutoff) {
      totalInPeriod++;
      byType[deletion.resourceType]++;
    }
  }

  const averageDeletionsPerDay = totalInPeriod / withinLastDays;

  // トレンド判定
  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (tracker.deletionHistory.length >= 2) {
    const recent = tracker.deletionHistory.slice(-3);
    const older = tracker.deletionHistory.slice(-6, -3);

    if (recent.length > 0 && older.length > 0) {
      const recentAvg = recent.reduce((sum, h) => sum + h.count, 0) / recent.length;
      const olderAvg = older.reduce((sum, h) => sum + h.count, 0) / older.length;

      if (recentAvg > olderAvg * 1.2) {
        trend = "increasing";
      } else if (recentAvg < olderAvg * 0.8) {
        trend = "decreasing";
      }
    }
  }

  return {
    totalDeletedInPeriod: totalInPeriod,
    averageDeletionsPerDay,
    deletionTrend: trend,
    byType
  };
}

/**
 * 削除レポートを生成
 */
export function generateDeletionReport(
  tracker: DeletedResourceTracker
): {
  totalDeleted: number;
  deletedByType: Record<string, number>;
  deletionPatterns: {
    totalInLastWeek: number;
    avgPerDay: number;
    trend: string;
  };
  recentDeletions: Array<{
    resourceType: string;
    name: string;
    timestamp: string;
    reason?: string;
  }>;
} {
  const patterns = detectDeletionPatterns(tracker);

  return {
    totalDeleted: tracker.deletedResources.length,
    deletedByType: tracker.deletedByType,
    deletionPatterns: {
      totalInLastWeek: patterns.totalDeletedInPeriod,
      avgPerDay: parseFloat(patterns.averageDeletionsPerDay.toFixed(2)),
      trend: patterns.deletionTrend
    },
    recentDeletions: getRecentlyDeletedResources(tracker, 10)
  };
}

/**
 * リソースが最近削除されたかチェック
 */
export function wasRecentlyDeleted(
  tracker: DeletedResourceTracker,
  resourceType: "skills" | "tools" | "presets",
  name: string,
  withinMinutes: number = 60
): boolean {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);

  return tracker.deletedResources.some(
    (r) =>
      r.resourceType === resourceType &&
      r.name === name &&
      new Date(r.timestamp) > cutoff
  );
}

/**
 * 削除統計をリセット
 */
export function resetDeletionStats(tracker: DeletedResourceTracker): void {
  tracker.deletedResources = [];
  tracker.deletedByType = {
    skills: 0,
    tools: 0,
    presets: 0
  };
  tracker.deletionHistory = [];
}

/**
 * Quality Check Failed Handler
 * 
 * 品質チェック失敗時にログを記録し、改善案を提案
 */

export interface QualityFailureRecord {
  resourceType: "skills" | "tools" | "presets";
  resourceName: string;
  errors: string[];
  timestamp: string;
}

export interface QualityCheckFailureTracker {
  failures: QualityFailureRecord[];
  failuresByResource: Map<string, number>;
  failuresByType: Record<"skills" | "tools" | "presets", number>;
}

/**
 * 品質チェック失敗トラッカーを初期化
 */
export function initializeQualityCheckFailureTracker(): QualityCheckFailureTracker {
  return {
    failures: [],
    failuresByResource: new Map(),
    failuresByType: {
      skills: 0,
      tools: 0,
      presets: 0
    }
  };
}

/**
 * 品質チェック失敗を記録
 */
export function recordQualityCheckFailure(
  tracker: QualityCheckFailureTracker,
  resourceType: "skills" | "tools" | "presets",
  resourceName: string,
  errors: string[]
): QualityFailureRecord {
  const record: QualityFailureRecord = {
    resourceType,
    resourceName,
    errors,
    timestamp: new Date().toISOString()
  };

  tracker.failures.push(record);

  // リソース別カウント
  const key = `${resourceType}:${resourceName}`;
  tracker.failuresByResource.set(key, (tracker.failuresByResource.get(key) ?? 0) + 1);

  // タイプ別カウント
  tracker.failuresByType[resourceType]++;

  // 履歴は最大100件
  if (tracker.failures.length > 100) {
    tracker.failures.shift();
  }

  return record;
}

/**
 * リソースの失敗回数を取得
 */
export function getResourceFailureCount(
  tracker: QualityCheckFailureTracker,
  resourceType: "skills" | "tools" | "presets",
  resourceName: string
): number {
  const key = `${resourceType}:${resourceName}`;
  return tracker.failuresByResource.get(key) ?? 0;
}

/**
 * 失敗のパターンを検出
 */
export function detectFailurePatterns(
  tracker: QualityCheckFailureTracker
): Array<{
  pattern: string;
  frequency: number;
  affectedResources: string[];
}> {
  const errorPatterns: Map<string, Set<string>> = new Map();

  for (const failure of tracker.failures) {
    for (const error of failure.errors) {
      const key = error.split(/\s+/).slice(0, 3).join(" "); // 最初の3語をパターンとして使用
      if (!errorPatterns.has(key)) {
        errorPatterns.set(key, new Set());
      }
      errorPatterns.get(key)!.add(`${failure.resourceType}:${failure.resourceName}`);
    }
  }

  const patterns: Array<{
    pattern: string;
    frequency: number;
    affectedResources: string[];
  }> = [];

  for (const [pattern, resources] of errorPatterns.entries()) {
    if (resources.size >= 2) {
      // 2個以上のリソースに影響する場合をパターンとして報告
      patterns.push({
        pattern,
        frequency: resources.size,
        affectedResources: Array.from(resources)
      });
    }
  }

  // 頻度でソート
  patterns.sort((a, b) => b.frequency - a.frequency);

  return patterns;
}

/**
 * 改善提案を生成
 */
export function generateImprovementSuggestions(
  tracker: QualityCheckFailureTracker
): Array<{
  priority: "high" | "medium" | "low";
  target: "skills" | "tools" | "presets" | "general";
  suggestion: string;
  affectedCount: number;
}> {
  const suggestions: Array<{
    priority: "high" | "medium" | "low";
    target: "skills" | "tools" | "presets" | "general";
    suggestion: string;
    affectedCount: number;
  }> = [];

  const patterns = detectFailurePatterns(tracker);

  for (const pattern of patterns.slice(0, 5)) {
    const priority = pattern.frequency >= 5 ? "high" : pattern.frequency >= 3 ? "medium" : "low";
    suggestions.push({
      priority,
      target: "general",
      suggestion: `エラーパターン「${pattern.pattern}」が頻出（${pattern.frequency}件）。ガイドラインの見直しを検討してください。`,
      affectedCount: pattern.frequency
    });
  }

  // リソースタイプ別の失敗率
  const total = tracker.failures.length;
  if (total > 0) {
    for (const [resourceType, count] of Object.entries(tracker.failuresByType)) {
      const rate = (count / total) * 100;
      if (rate > 30) {
        suggestions.push({
          priority: "high",
          target: resourceType as "skills" | "tools" | "presets",
          suggestion: `${resourceType}の失敗率が高い（${rate.toFixed(1)}%）。品質基準の見直しが必要です。`,
          affectedCount: count
        });
      }
    }
  }

  return suggestions;
}

/**
 * 失敗レポートを生成
 */
export function generateFailureReport(
  tracker: QualityCheckFailureTracker
): {
  totalFailures: number;
  failuresByType: Record<string, number>;
  failuresByResource: Array<{ resource: string; count: number }>;
  patterns: Array<{ pattern: string; frequency: number }>;
  suggestions: Array<{ priority: string; target: string; suggestion: string }>;
  recentFailures: Array<{
    resourceType: string;
    resourceName: string;
    errors: string[];
    timestamp: string;
  }>;
} {
  const failuresByResource = Array.from(tracker.failuresByResource.entries())
    .map(([resource, count]) => ({ resource, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const patterns = detectFailurePatterns(tracker);
  const suggestions = generateImprovementSuggestions(tracker);

  return {
    totalFailures: tracker.failures.length,
    failuresByType: tracker.failuresByType,
    failuresByResource,
    patterns: patterns.map((p) => ({ pattern: p.pattern, frequency: p.frequency })),
    suggestions: suggestions.map((s) => ({
      priority: s.priority,
      target: s.target,
      suggestion: s.suggestion
    })),
    recentFailures: tracker.failures.slice(-10).reverse()
  };
}

/**
 * 特定のリソースのすべての失敗を削除
 */
export function clearResourceFailures(
  tracker: QualityCheckFailureTracker,
  resourceType: "skills" | "tools" | "presets",
  resourceName: string
): void {
  const key = `${resourceType}:${resourceName}`;
  tracker.failuresByResource.delete(key);
  tracker.failures = tracker.failures.filter(
    (f) => !(f.resourceType === resourceType && f.resourceName === resourceName)
  );
}

/**
 * すべての失敗をクリア
 */
export function clearAllFailures(tracker: QualityCheckFailureTracker): void {
  tracker.failures = [];
  tracker.failuresByResource.clear();
  tracker.failuresByType = {
    skills: 0,
    tools: 0,
    presets: 0
  };
}

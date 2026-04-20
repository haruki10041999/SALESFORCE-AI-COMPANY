/**
 * Error Aggregate Handler
 * 
 * エラーを集約して、一定数のエラーが発生したツールを自動無効化
 */

export interface ToolErrorRecord {
  toolName: string;
  errorCount: number;
  lastError?: string;
  lastErrorTime?: string;
  errorHistory: Array<{
    error: string;
    timestamp: string;
  }>;
}

export interface ErrorAggregateTracker {
  toolErrors: Map<string, ToolErrorRecord>;
  aggregateWindow: number; // ミリ秒
  aggregateThreshold: number; // エラー数の閾値
}

/**
 * エラーアグリゲートトラッカーを初期化
 */
export function initializeErrorAggregateTracker(
  aggregateWindow: number = 10 * 60 * 1000, // 10分
  aggregateThreshold: number = 3 // 3エラー
): ErrorAggregateTracker {
  return {
    toolErrors: new Map(),
    aggregateWindow,
    aggregateThreshold
  };
}

/**
 * ツールのエラーを記録
 */
export function recordToolError(
  tracker: ErrorAggregateTracker,
  toolName: string,
  error: string
): ToolErrorRecord {
  const now = new Date().toISOString();
  
  let record = tracker.toolErrors.get(toolName);
  if (!record) {
    record = {
      toolName,
      errorCount: 0,
      errorHistory: []
    };
    tracker.toolErrors.set(toolName, record);
  }

  record.errorCount++;
  record.lastError = error;
  record.lastErrorTime = now;
  record.errorHistory.push({ error, timestamp: now });

  // 履歴は最大10件
  if (record.errorHistory.length > 10) {
    record.errorHistory.shift();
  }

  return record;
}

/**
 * エラー集約の対象となるツールを検出
 */
export function detectErrorAggregations(
  tracker: ErrorAggregateTracker
): Array<{
  toolName: string;
  errorCount: number;
  shouldDisable: boolean;
  reason: string;
}> {
  const results: Array<{
    toolName: string;
    errorCount: number;
    shouldDisable: boolean;
    reason: string;
  }> = [];

  const now = new Date();

  for (const [toolName, record] of tracker.toolErrors.entries()) {
    // ウィンドウ内のエラーをカウント
    const windowStart = new Date(now.getTime() - tracker.aggregateWindow);
    const recentErrors = record.errorHistory.filter(
      (e) => new Date(e.timestamp) > windowStart
    );

    if (recentErrors.length >= tracker.aggregateThreshold) {
      results.push({
        toolName,
        errorCount: record.errorCount,
        shouldDisable: true,
        reason: `${recentErrors.length}エラー/${tracker.aggregateThreshold}閾値を${tracker.aggregateWindow / 60000}分以内に超過`
      });
    }
  }

  return results;
}

/**
 * エラーレポートを生成
 */
export function generateErrorReport(
  tracker: ErrorAggregateTracker
): {
  totalToolsWithErrors: number;
  totalErrorCount: number;
  toolErrors: Array<{
    toolName: string;
    errorCount: number;
    lastError?: string;
    lastErrorTime?: string;
  }>;
  aggregationsDetected: Array<{
    toolName: string;
    errorCount: number;
    reason: string;
  }>;
} {
  const aggregations = detectErrorAggregations(tracker);

  let totalErrorCount = 0;
  const toolErrors: Array<{
    toolName: string;
    errorCount: number;
    lastError?: string;
    lastErrorTime?: string;
  }> = [];

  for (const [toolName, record] of tracker.toolErrors.entries()) {
    totalErrorCount += record.errorCount;
    toolErrors.push({
      toolName: record.toolName,
      errorCount: record.errorCount,
      lastError: record.lastError,
      lastErrorTime: record.lastErrorTime
    });
  }

  // エラー数でソート
  toolErrors.sort((a, b) => b.errorCount - a.errorCount);

  return {
    totalToolsWithErrors: tracker.toolErrors.size,
    totalErrorCount,
    toolErrors,
    aggregationsDetected: aggregations.map((a) => ({
      toolName: a.toolName,
      errorCount: a.errorCount,
      reason: a.reason
    }))
  };
}

/**
 * 特定のツールのエラーをリセット
 */
export function resetToolErrors(
  tracker: ErrorAggregateTracker,
  toolName: string
): void {
  tracker.toolErrors.delete(toolName);
}

/**
 * すべてのエラーをリセット
 */
export function resetAllErrors(tracker: ErrorAggregateTracker): void {
  tracker.toolErrors.clear();
}

/**
 * ツールの最後のエラーを取得
 */
export function getToolLastError(
  tracker: ErrorAggregateTracker,
  toolName: string
): string | undefined {
  return tracker.toolErrors.get(toolName)?.lastError;
}

/**
 * ツールのエラー数を取得
 */
export function getToolErrorCount(
  tracker: ErrorAggregateTracker,
  toolName: string
): number {
  return tracker.toolErrors.get(toolName)?.errorCount ?? 0;
}

export function buildHandlersDashboardMarkdown(params: {
  createdTracker: object;
  errorTracker: object;
}): string {
  const created = Object.entries(params.createdTracker ?? {});
  const errors = Object.entries(params.errorTracker ?? {});
  return [
    "## ハンドラーダッシュボード",
    "",
    "### 作成リソース",
    "| リソース名 | 件数 |",
    "|-----------|------|  ",
    ...created.slice(0, 20).map(([k, v]) => `| ${k} | ${JSON.stringify(v)} |`),
    "",
    "### エラー集計",
    "| ツール名 | エラー数 |",
    "|---------|----------|  ",
    ...errors.slice(0, 20).map(([k, v]) => `| ${k} | ${JSON.stringify(v)} |`)
  ].join("\n");
}

export function buildDrillDownMarkdown(params: {
  toolName?: string;
  status?: "running" | "success" | "error";
  aggregates: {
    matchedTraces: number;
    successCount: number;
    errorCount: number;
    runningCount: number;
    errorRate: number;
    avgDurationMs?: number | null;
    p95DurationMs?: number | null;
    matchedEvents: number;
    perTool: Array<{ toolName: string; total: number; errors: number }>;
  };
}): string {
  const agg = params.aggregates;
  return [
    `## Drill-Down${params.toolName ? `: ${params.toolName}` : ""}${params.status ? ` [${params.status}]` : ""}`,
    "",
    "| 指標 | 値 |",
    "|------|-----|",
    `| マッチしたトレース | ${agg.matchedTraces} |`,
    `| 成功 | ${agg.successCount} |`,
    `| エラー | ${agg.errorCount} |`,
    `| 実行中 | ${agg.runningCount} |`,
    `| エラー率 | ${(agg.errorRate * 100).toFixed(1)}% |`,
    `| 平均実行時間 | ${agg.avgDurationMs != null ? `${agg.avgDurationMs.toFixed(0)}ms` : "-"} |`,
    `| P95 実行時間 | ${agg.p95DurationMs != null ? `${agg.p95DurationMs.toFixed(0)}ms` : "-"} |`,
    `| マッチしたイベント | ${agg.matchedEvents} |`,
    "",
    "### ツール別集計",
    "| ツール名 | 合計 | エラー |",
    "|---------|------|--------|",
    ...agg.perTool.slice(0, 20).map((p) => `| ${p.toolName} | ${p.total} | ${p.errors} |`)
  ].join("\n");
}

export function buildToolExecutionStatsMarkdown(params: {
  windowMinutes: number;
  sampledEvents: number;
  totals: { total: number };
  rates: { successRate: number; failureRate: number };
  disabledTools: string[];
  perTool: Record<string, { total: number; success: number; failure: number }>;
}): string {
  return [
    `## ツール実行統計 (直近 ${params.windowMinutes}分)`,
    "",
    `- サンプル数: ${params.sampledEvents} / 合計: ${params.totals.total} / 成功率: ${params.rates.successRate}% / 失敗率: ${params.rates.failureRate}%`,
    ...(params.disabledTools.length > 0 ? [`- 無効化ツール: ${params.disabledTools.join(", ")}`] : []),
    "",
    "| ツール名 | 合計 | 成功 | 失敗 |",
    "|---------|------|------|------|  ",
    ...Object.entries(params.perTool)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([name, s]) => `| ${name} | ${s.total} | ${s.success} | ${s.failure} |`)
  ].join("\n");
}

export function buildFeedbackMetricsMarkdown(metrics: {
  totalFeedback: number;
  thumbsUpCount: number;
  thumbsUpRate: number;
  thumbsDownCount: number;
  neutralCount: number;
  averageQualityScore?: number | null;
  mostCommonTags?: Array<{ tag: string; count: number }>;
}): string {
  return [
    "## フィードバックメトリクス",
    "",
    "| 指標 | 値 |",
    "|------|-----|",
    `| 総フィードバック数 | ${metrics.totalFeedback} |`,
    `| 👍 高評価 | ${metrics.thumbsUpCount} (${(metrics.thumbsUpRate * 100).toFixed(1)}%) |`,
    `| 👎 低評価 | ${metrics.thumbsDownCount} |`,
    `| 中立 | ${metrics.neutralCount} |`,
    ...(metrics.averageQualityScore != null
      ? [`| 平均品質スコア | ${metrics.averageQualityScore.toFixed(2)} |`]
      : []),
    ...(metrics.mostCommonTags && metrics.mostCommonTags.length > 0
      ? ["", "### タグ別件数", ...metrics.mostCommonTags.slice(0, 10).map((t) => `- **${t.tag}**: ${t.count}件`)]
      : [])
  ].join("\n");
}

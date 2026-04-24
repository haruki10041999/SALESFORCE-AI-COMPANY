import { getActiveTraces, getCompletedTraces } from "../core/trace/trace-context.js";
import { getPromptCacheMetrics } from "../core/context/chat-prompt-builder.js";

export type ToolSlaThreshold = {
  maxP95Ms?: number;
  maxErrorRatePercent?: number;
};

export type MetricsSummaryInput = {
  limit?: number;
  maxP95Ms?: number;
  maxErrorRatePercent?: number;
  /**
   * ツール名・グロブをキーとする SLA 閉値設定。
   * キーは tool 名、または "prefix*" 形式の prefix glob。
   * 同一ツールに複数マッチした場合は exact > glob の順で適用される。
   */
  toolSlaThresholds?: Record<string, ToolSlaThreshold>;
};

export type MetricsSummaryResult = {
  activeCount: number;
  completedCount: number;
  successRate: number;
  errorRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowest: Array<{ traceId: string; toolName: string; durationMs: number; status: "success" | "error" }>;
  /**
   * Phase 別のデュレーション集計 (TASK-038)
   * Phase API を使用した trace のみ集計対象。
   */
  phaseBreakdown?: Array<{
    name: "input" | "plan" | "execute" | "render";
    sampleCount: number;
    averageDurationMs: number;
    p95DurationMs: number;
  }>;
  promptCache?: {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    expirations: number;
    size: number;
    maxSize: number;
  };
  slaEvaluation?: {
    thresholds: {
      maxP95Ms: number;
      maxErrorRatePercent: number;
    };
    values: {
      p95DurationMs: number;
      errorRatePercent: number;
    };
    alerts: Array<{ id: string; metric: "p95DurationMs" | "errorRatePercent"; message: string }>;
    pass: boolean;
    /**
     * ツール別 SLA 評価結果。`toolSlaThresholds` が与えられた場合のみ生成される。
     */
    perTool?: Array<{
      toolName: string;
      matchedPattern: string;
      thresholds: { maxP95Ms: number; maxErrorRatePercent: number };
      values: { p95DurationMs: number; errorRatePercent: number; sampleCount: number };
      alerts: Array<{ id: string; metric: "p95DurationMs" | "errorRatePercent"; message: string }>;
      pass: boolean;
    }>;
  };
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function summarizeMetrics(input: MetricsSummaryInput = {}): MetricsSummaryResult {
  const limit = Number.isFinite(input.limit) && (input.limit ?? 0) > 0
    ? Math.min(1000, Math.floor(input.limit as number))
    : 200;

  const maxP95Ms = Number.isFinite(input.maxP95Ms) ? Math.max(1, Math.floor(input.maxP95Ms as number)) : 200;
  const maxErrorRatePercent = Number.isFinite(input.maxErrorRatePercent)
    ? Math.max(0, Math.min(100, Number(input.maxErrorRatePercent)))
    : 5;

  const completed = getCompletedTraces(limit);
  const active = getActiveTraces();

  const success = completed.filter((t) => t.status === "success").length;
  const errors = completed.filter((t) => t.status === "error").length;
  const durations = completed
    .map((t) => t.durationMs ?? 0)
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  const avg = durations.length === 0
    ? 0
    : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  const p95 = Math.round(percentile(durations, 95));

  const slowest = completed
    .filter((t) => typeof t.durationMs === "number")
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 10)
    .map((t) => ({
      traceId: t.traceId,
      toolName: t.toolName,
      durationMs: t.durationMs ?? 0,
      status: t.status === "running" ? "error" : t.status
    }));

  const completedCount = completed.length;
  const successRate = completedCount === 0 ? 0 : Number((success / completedCount).toFixed(3));
  const errorRate = completedCount === 0 ? 0 : Number((errors / completedCount).toFixed(3));
  const errorRatePercent = Number((errorRate * 100).toFixed(2));

  const slaAlerts: Array<{ id: string; metric: "p95DurationMs" | "errorRatePercent"; message: string }> = [];
  if (p95 > maxP95Ms) {
    slaAlerts.push({
      id: "sla-p95",
      metric: "p95DurationMs",
      message: `p95DurationMs exceeded threshold (${p95}ms > ${maxP95Ms}ms)`
    });
  }
  if (errorRatePercent > maxErrorRatePercent) {
    slaAlerts.push({
      id: "sla-error-rate",
      metric: "errorRatePercent",
      message: `errorRatePercent exceeded threshold (${errorRatePercent}% > ${maxErrorRatePercent}%)`
    });
  }

  // Get prompt cache metrics
  const cacheMetrics = getPromptCacheMetrics();
  const totalCacheOps = cacheMetrics.hits + cacheMetrics.misses;
  const hitRate = totalCacheOps === 0 ? 0 : Number((cacheMetrics.hits / totalCacheOps).toFixed(3));

  // Per-tool SLA evaluation
  const perToolSla = evaluatePerToolSla(completed, input.toolSlaThresholds);

  // Phase breakdown (TASK-038)
  const phaseBreakdown = aggregatePhases(completed);

  return {
    activeCount: active.length,
    completedCount,
    successRate,
    errorRate,
    averageDurationMs: avg,
    p95DurationMs: p95,
    slowest,
    ...(phaseBreakdown.length > 0 ? { phaseBreakdown } : {}),
    slaEvaluation: {
      thresholds: {
        maxP95Ms,
        maxErrorRatePercent
      },
      values: {
        p95DurationMs: p95,
        errorRatePercent
      },
      alerts: slaAlerts,
      pass: slaAlerts.length === 0 && perToolSla.every((entry) => entry.pass),
      ...(perToolSla.length > 0 ? { perTool: perToolSla } : {})
    },
    promptCache: {
      hits: cacheMetrics.hits,
      misses: cacheMetrics.misses,
      hitRate,
      evictions: cacheMetrics.evictions,
      expirations: cacheMetrics.expirations,
      size: cacheMetrics.size,
      maxSize: cacheMetrics.maxSize
    }
  };
}

function matchToolPattern(toolName: string, patterns: string[]): string | null {
  // exact match preferred
  if (patterns.includes(toolName)) return toolName;
  let best: { pattern: string; length: number } | null = null;
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (toolName.startsWith(prefix) && (!best || prefix.length > best.length)) {
        best = { pattern, length: prefix.length };
      }
    }
  }
  return best?.pattern ?? null;
}

function evaluatePerToolSla(
  completed: ReturnType<typeof getCompletedTraces>,
  toolSlaThresholds: Record<string, ToolSlaThreshold> | undefined
): NonNullable<NonNullable<MetricsSummaryResult["slaEvaluation"]>["perTool"]> {
  if (!toolSlaThresholds || Object.keys(toolSlaThresholds).length === 0) return [];
  const patterns = Object.keys(toolSlaThresholds);

  // group traces by matched pattern
  const grouped = new Map<string, { toolName: string; pattern: string; durations: number[]; errors: number; total: number }>();
  for (const trace of completed) {
    const matched = matchToolPattern(trace.toolName, patterns);
    if (!matched) continue;
    const key = `${trace.toolName}::${matched}`;
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { toolName: trace.toolName, pattern: matched, durations: [], errors: 0, total: 0 };
      grouped.set(key, bucket);
    }
    bucket.total += 1;
    if (trace.status === "error") bucket.errors += 1;
    if (typeof trace.durationMs === "number" && Number.isFinite(trace.durationMs) && trace.durationMs >= 0) {
      bucket.durations.push(trace.durationMs);
    }
  }

  const results: NonNullable<NonNullable<MetricsSummaryResult["slaEvaluation"]>["perTool"]> = [];
  for (const [, bucket] of grouped) {
    const cfg = toolSlaThresholds[bucket.pattern];
    const maxP95 = Number.isFinite(cfg.maxP95Ms) ? Math.max(1, Math.floor(cfg.maxP95Ms as number)) : 200;
    const maxErr = Number.isFinite(cfg.maxErrorRatePercent)
      ? Math.max(0, Math.min(100, Number(cfg.maxErrorRatePercent)))
      : 5;
    const sortedDurations = [...bucket.durations].sort((a, b) => a - b);
    const p95Tool = Math.round(percentile(sortedDurations, 95));
    const errRateTool = bucket.total === 0 ? 0 : Number(((bucket.errors / bucket.total) * 100).toFixed(2));

    const alerts: Array<{ id: string; metric: "p95DurationMs" | "errorRatePercent"; message: string }> = [];
    if (p95Tool > maxP95) {
      alerts.push({
        id: `sla-p95-${bucket.toolName}`,
        metric: "p95DurationMs",
        message: `${bucket.toolName}: p95DurationMs exceeded threshold (${p95Tool}ms > ${maxP95}ms)`
      });
    }
    if (errRateTool > maxErr) {
      alerts.push({
        id: `sla-error-rate-${bucket.toolName}`,
        metric: "errorRatePercent",
        message: `${bucket.toolName}: errorRatePercent exceeded threshold (${errRateTool}% > ${maxErr}%)`
      });
    }

    results.push({
      toolName: bucket.toolName,
      matchedPattern: bucket.pattern,
      thresholds: { maxP95Ms: maxP95, maxErrorRatePercent: maxErr },
      values: { p95DurationMs: p95Tool, errorRatePercent: errRateTool, sampleCount: bucket.total },
      alerts,
      pass: alerts.length === 0
    });
  }
  return results;
}

/**
 * Phase 別集計 (TASK-038)
 *
 * Phase API を利用している trace の phases[] を phase 名ごとにグループし、平均・p95 を返す。
 * どの trace も phases を使っていなければ空配列。
 */
function aggregatePhases(
  completed: ReturnType<typeof getCompletedTraces>
): NonNullable<MetricsSummaryResult["phaseBreakdown"]> {
  const buckets = new Map<"input" | "plan" | "execute" | "render", number[]>();
  for (const trace of completed) {
    const phases = (trace as unknown as { phases?: Array<{ name: string; durationMs?: number }> }).phases;
    if (!Array.isArray(phases)) continue;
    for (const phase of phases) {
      if (
        (phase.name === "input" || phase.name === "plan" || phase.name === "execute" || phase.name === "render") &&
        typeof phase.durationMs === "number" &&
        Number.isFinite(phase.durationMs) &&
        phase.durationMs >= 0
      ) {
        let arr = buckets.get(phase.name);
        if (!arr) {
          arr = [];
          buckets.set(phase.name, arr);
        }
        arr.push(phase.durationMs);
      }
    }
  }

  const result: NonNullable<MetricsSummaryResult["phaseBreakdown"]> = [];
  const order: Array<"input" | "plan" | "execute" | "render"> = ["input", "plan", "execute", "render"];
  for (const name of order) {
    const arr = buckets.get(name);
    if (!arr || arr.length === 0) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const avgMs = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    const p95Ms = Math.round(percentile(sorted, 95));
    result.push({
      name,
      sampleCount: sorted.length,
      averageDurationMs: avgMs,
      p95DurationMs: p95Ms
    });
  }
  return result;
}

import { getActiveTraces, getCompletedTraces } from "../core/trace/trace-context.js";
import { getPromptCacheMetrics } from "../core/context/chat-prompt-builder.js";

export type MetricsSummaryInput = {
  limit?: number;
  maxP95Ms?: number;
  maxErrorRatePercent?: number;
};

export type MetricsSummaryResult = {
  activeCount: number;
  completedCount: number;
  successRate: number;
  errorRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowest: Array<{ traceId: string; toolName: string; durationMs: number; status: "success" | "error" }>;
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

  return {
    activeCount: active.length,
    completedCount,
    successRate,
    errorRate,
    averageDurationMs: avg,
    p95DurationMs: p95,
    slowest,
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
      pass: slaAlerts.length === 0
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

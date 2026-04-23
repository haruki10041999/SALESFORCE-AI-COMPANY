import { getActiveTraces, getCompletedTraces } from "../core/trace/trace-context.js";

export type MetricsSummaryInput = {
  limit?: number;
};

export type MetricsSummaryResult = {
  activeCount: number;
  completedCount: number;
  successRate: number;
  errorRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowest: Array<{ traceId: string; toolName: string; durationMs: number; status: "success" | "error" }>;
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

  return {
    activeCount: active.length,
    completedCount,
    successRate,
    errorRate,
    averageDurationMs: avg,
    p95DurationMs: p95,
    slowest
  };
}

/**
 * A15: Dashboard drill-down
 *
 * `buildObservabilityDashboard` が提供するサマリでは把握しきれない、
 * 特定ツール / 期間 / ステータスに絞り込んだ詳細ビューを生成する。
 *
 * - 入力: trace 配列 + event 配列 + フィルタ条件
 * - 出力: 期間内のすべての trace / event / 集計を JSON で返す
 *
 * 純粋関数で副作用なし。HTML / Markdown レンダラは UI 層に委譲する。
 */
import type {
  ObservabilityTrace,
  ObservabilityEvent
} from "./dashboard.js";

export interface DrillDownFilter {
  toolName?: string;
  status?: "running" | "success" | "error";
  since?: string;
  until?: string;
  eventType?: string;
  limit?: number;
}

export interface DrillDownTraceDetail {
  trace: ObservabilityTrace;
  relatedEvents: ObservabilityEvent[];
}

export interface DrillDownAggregates {
  matchedTraces: number;
  matchedEvents: number;
  successCount: number;
  errorCount: number;
  runningCount: number;
  errorRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  perTool: Array<{ toolName: string; total: number; errors: number }>;
  perEventType: Array<{ event: string; count: number }>;
  errorMessages: Array<{ message: string; count: number }>;
}

export interface DrillDownResult {
  filter: DrillDownFilter;
  generatedAt: string;
  aggregates: DrillDownAggregates;
  details: DrillDownTraceDetail[];
}

const DEFAULT_LIMIT = 100;
const CORRELATION_WINDOW_MS = 5000;

function safeTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function inRange(ts: number | null, sinceMs: number | null, untilMs: number | null): boolean {
  if (ts === null) return false;
  if (sinceMs !== null && ts < sinceMs) return false;
  if (untilMs !== null && ts > untilMs) return false;
  return true;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function drillDownDashboard(
  traces: ObservabilityTrace[],
  events: ObservabilityEvent[],
  filter: DrillDownFilter = {}
): DrillDownResult {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const sinceMs = filter.since ? safeTime(filter.since) : null;
  const untilMs = filter.until ? safeTime(filter.until) : null;

  const matchedTraces: ObservabilityTrace[] = [];
  for (const t of traces) {
    if (filter.toolName && t.toolName !== filter.toolName) continue;
    if (filter.status && t.status !== filter.status) continue;
    const ref = safeTime(t.endedAt) ?? safeTime(t.startedAt);
    if ((sinceMs !== null || untilMs !== null) && !inRange(ref, sinceMs, untilMs)) continue;
    matchedTraces.push(t);
  }

  // 新しい順
  matchedTraces.sort((a, b) => {
    const ta = safeTime(a.endedAt) ?? safeTime(a.startedAt) ?? 0;
    const tb = safeTime(b.endedAt) ?? safeTime(b.startedAt) ?? 0;
    return tb - ta;
  });

  const matchedEvents: ObservabilityEvent[] = [];
  for (const ev of events) {
    if (filter.eventType && ev.event !== filter.eventType) continue;
    const ts = safeTime(ev.timestamp);
    if ((sinceMs !== null || untilMs !== null) && !inRange(ts, sinceMs, untilMs)) continue;
    matchedEvents.push(ev);
  }

  // 集計
  let successCount = 0;
  let errorCount = 0;
  let runningCount = 0;
  const durations: number[] = [];
  const perToolMap = new Map<string, { total: number; errors: number }>();
  const errorMsgMap = new Map<string, number>();

  for (const t of matchedTraces) {
    if (t.status === "success") successCount += 1;
    else if (t.status === "error") errorCount += 1;
    else runningCount += 1;

    if (typeof t.durationMs === "number" && t.durationMs >= 0) {
      durations.push(t.durationMs);
    }

    const entry = perToolMap.get(t.toolName) ?? { total: 0, errors: 0 };
    entry.total += 1;
    if (t.status === "error") entry.errors += 1;
    perToolMap.set(t.toolName, entry);

    if (t.status === "error" && t.errorMessage) {
      errorMsgMap.set(t.errorMessage, (errorMsgMap.get(t.errorMessage) ?? 0) + 1);
    }
  }

  const perEventTypeMap = new Map<string, number>();
  for (const ev of matchedEvents) {
    perEventTypeMap.set(ev.event, (perEventTypeMap.get(ev.event) ?? 0) + 1);
  }

  durations.sort((a, b) => a - b);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((s, v) => s + v, 0) / durations.length
    : null;

  const totalFinished = successCount + errorCount;
  const errorRate = totalFinished === 0 ? 0 : errorCount / totalFinished;

  // 詳細 (trace と correlation window の event)
  const details: DrillDownTraceDetail[] = matchedTraces.slice(0, limit).map((trace) => {
    const center = safeTime(trace.endedAt) ?? safeTime(trace.startedAt);
    const related: ObservabilityEvent[] = [];
    if (center !== null) {
      for (const ev of matchedEvents) {
        const ts = safeTime(ev.timestamp);
        if (ts === null) continue;
        if (Math.abs(ts - center) <= CORRELATION_WINDOW_MS) {
          related.push(ev);
        }
      }
      related.sort((a, b) => (safeTime(a.timestamp) ?? 0) - (safeTime(b.timestamp) ?? 0));
    }
    return { trace, relatedEvents: related };
  });

  const aggregates: DrillDownAggregates = {
    matchedTraces: matchedTraces.length,
    matchedEvents: matchedEvents.length,
    successCount,
    errorCount,
    runningCount,
    errorRate: Number(errorRate.toFixed(4)),
    avgDurationMs: avgDurationMs !== null ? Number(avgDurationMs.toFixed(2)) : null,
    p95DurationMs: percentile(durations, 95),
    perTool: [...perToolMap.entries()]
      .map(([toolName, v]) => ({ toolName, ...v }))
      .sort((a, b) => b.total - a.total || a.toolName.localeCompare(b.toolName)),
    perEventType: [...perEventTypeMap.entries()]
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event)),
    errorMessages: [...errorMsgMap.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  };

  return {
    filter,
    generatedAt: new Date().toISOString(),
    aggregates,
    details
  };
}

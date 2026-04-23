/**
 * Metrics Tool
 *
 * ツール実行時間・成功率・キャッシュヒット率などのランタイムメトリクスを
 * 収集・集計・返却する。
 *
 * register-analytics-tools.ts から govTool として登録される。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ToolMetricSample {
  toolName: string;
  traceId?: string;
  startedAt: string;
  durationMs: number;
  status: "success" | "error";
  cacheHit?: boolean;
}

export interface AggregatedToolMetrics {
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  cacheHitRate: number;
  lastCalledAt: string;
}

export interface MetricsSummary {
  totalCalls: number;
  totalErrors: number;
  overallSuccessRate: number;
  overallAvgDurationMs: number;
  perTool: AggregatedToolMetrics[];
  collectedSince: string;
  asOf: string;
}

const MAX_SAMPLES = Number.parseInt(process.env.METRICS_SAMPLES_MAX ?? "2000", 10);
const samples: ToolMetricSample[] = [];
const collectedSince = new Date().toISOString();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_METRICS_FILE = join(ROOT, "outputs", "events", "metrics-samples.jsonl");
let storageFilePath = process.env.SF_AI_METRICS_FILE ?? DEFAULT_METRICS_FILE;

function loadFromDisk(): void {
  samples.length = 0;
  if (!existsSync(storageFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(storageFilePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<ToolMetricSample>;
        if (
          typeof parsed.toolName === "string" &&
          typeof parsed.startedAt === "string" &&
          typeof parsed.durationMs === "number" &&
          (parsed.status === "success" || parsed.status === "error")
        ) {
          samples.push({
            toolName: parsed.toolName,
            traceId: typeof parsed.traceId === "string" ? parsed.traceId : undefined,
            startedAt: parsed.startedAt,
            durationMs: parsed.durationMs,
            status: parsed.status,
            cacheHit: parsed.cacheHit === true
          });
        }
      } catch {
        // ignore malformed lines
      }
    }
    if (samples.length > MAX_SAMPLES) {
      samples.splice(0, samples.length - MAX_SAMPLES);
    }
  } catch {
    // ignore read failures to keep runtime resilient
  }
}

function saveToDisk(): void {
  try {
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const payload = samples.slice(-MAX_SAMPLES).map((s) => JSON.stringify(s)).join("\n");
    writeFileSync(storageFilePath, payload.length > 0 ? `${payload}\n` : "", "utf-8");
  } catch {
    // ignore write failures to keep runtime resilient
  }
}

/** メトリクスサンプルを記録 */
export function recordMetric(sample: ToolMetricSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
  saveToDisk();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * (p / 100));
  return sorted[idx] ?? 0;
}

/** 全ツールのメトリクスを集計して返す */
export function getMetricsSummary(): MetricsSummary {
  const toolMap = new Map<string, ToolMetricSample[]>();

  for (const s of samples) {
    if (!toolMap.has(s.toolName)) toolMap.set(s.toolName, []);
    toolMap.get(s.toolName)!.push(s);
  }

  const perTool: AggregatedToolMetrics[] = [];

  for (const [toolName, toolSamples] of toolMap.entries()) {
    const successSamples = toolSamples.filter((s) => s.status === "success");
    const durations = toolSamples.map((s) => s.durationMs).sort((a, b) => a - b);
    const cacheHits = toolSamples.filter((s) => s.cacheHit === true).length;
    const last = toolSamples.at(-1);

    perTool.push({
      toolName,
      callCount: toolSamples.length,
      successCount: successSamples.length,
      errorCount: toolSamples.length - successSamples.length,
      avgDurationMs:
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      maxDurationMs: durations.at(-1) ?? 0,
      cacheHitRate: toolSamples.length > 0 ? cacheHits / toolSamples.length : 0,
      lastCalledAt: last?.startedAt ?? ""
    });
  }

  perTool.sort((a, b) => b.callCount - a.callCount);

  const totalCalls = samples.length;
  const totalErrors = samples.filter((s) => s.status === "error").length;
  const allDurations = samples.map((s) => s.durationMs);
  const overallAvg =
    allDurations.length > 0
      ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
      : 0;

  return {
    totalCalls,
    totalErrors,
    overallSuccessRate: totalCalls > 0 ? (totalCalls - totalErrors) / totalCalls : 1,
    overallAvgDurationMs: overallAvg,
    perTool,
    collectedSince,
    asOf: new Date().toISOString()
  };
}

/** メトリクスをリセット（テスト用途） */
export function resetMetrics(): void {
  samples.splice(0, samples.length);
  saveToDisk();
}

export function configureMetricsStorageForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
}

loadFromDisk();

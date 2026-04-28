#!/usr/bin/env tsx
/**
 * metrics-sla-archive.ts
 *
 * 日次のメトリクススナップショットを outputs/audit/ に蓄積し、
 * SLA 実績トレンドの追跡を可能にします。
 *
 * 実行例:
 *   npm run ai -- --script metrics-sla-archive
 *   or npx tsx scripts/metrics-sla-archive.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const METRICS_FILE = process.env.SF_AI_METRICS_FILE
  ? resolve(process.env.SF_AI_METRICS_FILE)
  : join(ROOT, "outputs", "events", "metrics-samples.jsonl");

const AUDIT_DIR = join(ROOT, "outputs", "audit");
const SLA_JOURNAL_FILE = join(AUDIT_DIR, "sla-journal.jsonl");

interface MetricsSnapshot {
  timestamp: string;
  successRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalCount: number;
  failureCount: number;
  toolMetrics: Record<
    string,
    {
      name: string;
      count: number;
      successCount: number;
      avgDurationMs: number;
      p95DurationMs: number;
    }
  >;
}

interface SLAEntry {
  date: string;
  timestamp: string;
  successRate: number;
  p95DurationMs: number;
  totalCount: number;
  failureCount: number;
  alertLevel: "ok" | "warning" | "critical";
  alertReason?: string;
  toolFailures?: Array<{ toolName: string; errorRate: number; failureCount: number }>;
}

function getDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

function evaluateSLA(snapshot: MetricsSnapshot): SLAEntry {
  const date = getDateString();
  const alerts: string[] = [];
  let alertLevel: "ok" | "warning" | "critical" = "ok";

  // SLA 基準
  const SLA_SUCCESS_RATE = 0.95; // 95%
  const SLA_P95_MS = 2000; // 2000ms

  if (snapshot.successRate < SLA_SUCCESS_RATE) {
    alertLevel = snapshot.successRate < 0.9 ? "critical" : "warning";
    alerts.push(
      `Success rate ${(snapshot.successRate * 100).toFixed(2)}% < ${(SLA_SUCCESS_RATE * 100).toFixed(0)}%`
    );
  }

  if (snapshot.p95DurationMs > SLA_P95_MS) {
    alertLevel = snapshot.p95DurationMs > 5000 ? "critical" : "warning";
    alerts.push(`p95 latency ${snapshot.p95DurationMs}ms > ${SLA_P95_MS}ms`);
  }

  // ツール別エラー率
  const toolFailures = Object.entries(snapshot.toolMetrics || {})
    .map(([, metrics]) => {
      const errorRate = 1 - (metrics.successCount ?? 0) / (metrics.count ?? 1);
      return {
        toolName: metrics.name,
        errorRate,
        failureCount: metrics.count - (metrics.successCount ?? 0)
      };
    })
    .filter((tf) => tf.errorRate > 0.05)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 5);

  return {
    date,
    timestamp: new Date().toISOString(),
    successRate: snapshot.successRate,
    p95DurationMs: snapshot.p95DurationMs,
    totalCount: snapshot.totalCount,
    failureCount: snapshot.failureCount,
    alertLevel,
    alertReason: alerts.length > 0 ? alerts.join("; ") : undefined,
    toolFailures: toolFailures.length > 0 ? toolFailures : undefined
  };
}

function readLatestSnapshot(): MetricsSnapshot | null {
  if (!existsSync(METRICS_FILE)) {
    console.warn(`[warn] metrics file not found: ${METRICS_FILE}`);
    return null;
  }

  try {
    const lines = readFileSync(METRICS_FILE, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    // 最新行を読む（テーリングになっているので、最後から5行読んで平均）
    const recentLines = lines.slice(Math.max(0, lines.length - 10));
    const metrics = recentLines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((m): m is Record<string, unknown> => m !== null);

    if (metrics.length === 0) {
      return null;
    }

    // 簡易的に最新のメトリクスを return
    // 本来は metrics:snapshot で加工済みのものを使うべきだが、
    // ここではサンプルから直接集計
    const latestMetric = metrics[metrics.length - 1];
    return (latestMetric as unknown as MetricsSnapshot) ?? null;
  } catch (err) {
    console.error(`[error] failed to read metrics: ${err}`);
    return null;
  }
}

async function main(): Promise<void> {
  // ディレクトリ作成
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }

  // 最新スナップショットを読む
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.log("[info] no metrics snapshot available, skipping SLA archive");
    return;
  }

  // SLA 評価
  const entry = evaluateSLA(snapshot);

  // アーカイブに追記
  appendFileSync(SLA_JOURNAL_FILE, `${JSON.stringify(entry)}\n`, "utf-8");
  console.log(`[info] SLA entry archived (${entry.date}, alert=${entry.alertLevel})`);

  // 日付ごとのスナップショット JSON も保存
  const dailyFile = join(AUDIT_DIR, `metrics-${entry.date}.json`);
  writeFileSync(dailyFile, JSON.stringify({ ...snapshot, ...entry }, null, 2), "utf-8");
  console.log(`[info] daily snapshot saved: ${dailyFile}`);

  // アラートがあれば出力
  if (entry.alertLevel !== "ok") {
    console.warn(
      `[${entry.alertLevel.toUpperCase()}] SLA alert: ${entry.alertReason || "unknown"}`
    );
    if (entry.toolFailures && entry.toolFailures.length > 0) {
      console.warn(
        `[${entry.alertLevel.toUpperCase()}] Tool failures: ${entry.toolFailures.map((tf) => `${tf.toolName}=${(tf.errorRate * 100).toFixed(1)}%`).join(", ")}`
      );
    }
  }
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});

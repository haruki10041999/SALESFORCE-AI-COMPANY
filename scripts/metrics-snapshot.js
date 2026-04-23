#!/usr/bin/env node
/**
 * metrics-snapshot.js
 *
 * metrics-samples.jsonl から公開用スナップショット JSON を生成します。
 *
 * 実行例:
 *   npm run metrics:snapshot
 *   npm run metrics:snapshot -- --days 30 --top 15 --output docs/metrics-snapshot.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEFAULT_INPUT = process.env.SF_AI_METRICS_FILE
  ? resolve(process.env.SF_AI_METRICS_FILE)
  : join(ROOT, "outputs", "events", "metrics-samples.jsonl");
const DEFAULT_OUTPUT = join(ROOT, "docs", "metrics-snapshot.json");

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    top: 15,
    days: 30
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      options.input = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      options.output = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--top" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.top = Math.min(parsed, 50);
      i += 1;
      continue;
    }
    if (token === "--days" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.min(parsed, 120);
      i += 1;
      continue;
    }
  }

  return options;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * (p / 100));
  return sorted[idx] ?? 0;
}

function readSamples(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`metrics file not found: ${filePath}`);
  }

  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row.toolName === "string" && typeof row.durationMs === "number" && typeof row.startedAt === "string" && (row.status === "success" || row.status === "error"));
}

function buildSummary(samples, topN, days) {
  const toolMap = new Map();
  for (const s of samples) {
    if (!toolMap.has(s.toolName)) toolMap.set(s.toolName, []);
    toolMap.get(s.toolName).push(s);
  }

  const perTool = [];
  for (const [toolName, list] of toolMap.entries()) {
    const durations = list.map((x) => x.durationMs).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const errors = list.filter((x) => x.status === "error").length;
    const success = list.length - errors;
    perTool.push({
      toolName,
      calls: list.length,
      errors,
      successRate: list.length === 0 ? 0 : Number((success / list.length).toFixed(3)),
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p95Ms: Math.round(percentile(durations, 95))
    });
  }
  perTool.sort((a, b) => b.calls - a.calls);

  const totalCalls = samples.length;
  const totalErrors = samples.filter((x) => x.status === "error").length;
  const durations = samples.map((x) => x.durationMs).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const bucket = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    bucket.set(key, { date: key, calls: 0, errors: 0 });
  }

  for (const s of samples) {
    const dt = new Date(s.startedAt);
    if (Number.isNaN(dt.getTime()) || dt < start || dt > end) continue;
    const key = dt.toISOString().slice(0, 10);
    const row = bucket.get(key);
    if (!row) continue;
    row.calls += 1;
    if (s.status === "error") row.errors += 1;
  }

  const trend = [...bucket.values()].map((x) => ({
    date: x.date,
    calls: x.calls,
    successRate: x.calls === 0 ? 1 : Number(((x.calls - x.errors) / x.calls).toFixed(3))
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalCalls,
    totalErrors,
    successRate: totalCalls === 0 ? 1 : Number(((totalCalls - totalErrors) / totalCalls).toFixed(3)),
    p95Ms: Math.round(percentile(durations, 95)),
    perTool: perTool.slice(0, topN),
    trend
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const samples = readSamples(options.input);
  const summary = buildSummary(samples, options.top, options.days);

  const snapshot = {
    schemaVersion: 1,
    sourceFile: options.input,
    generatedAt: new Date().toISOString(),
    windowDays: options.days,
    topN: options.top,
    sampleCount: samples.length,
    summary
  };

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(snapshot, null, 2), "utf-8");

  console.log(`[metrics-snapshot] wrote ${options.output}`);
  console.log(`[metrics-snapshot] sampleCount=${samples.length} windowDays=${options.days} topN=${options.top}`);
}

try {
  main();
} catch (error) {
  console.error(`[metrics-snapshot][ERROR] ${String(error)}`);
  process.exit(1);
}

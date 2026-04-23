#!/usr/bin/env node
/**
 * metrics-report.js
 *
 * metrics-samples.jsonl を読み込み、ツール別の呼び出し統計を表示します。
 * 実行例:
 *   npm run metrics:report
 *   npm run metrics:report -- --top 15
 *   npm run metrics:report -- --json
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_FILE = process.env.SF_AI_METRICS_FILE
  ? resolve(process.env.SF_AI_METRICS_FILE)
  : join(ROOT, "outputs", "events", "metrics-samples.jsonl");

function parseArgs(argv) {
  const options = {
    file: DEFAULT_FILE,
    top: 10,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file" && argv[i + 1]) {
      options.file = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--top" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.top = Math.min(parsed, 100);
      }
      i += 1;
      continue;
    }
    if (token === "--json") {
      options.json = true;
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

function aggregate(samples) {
  const groups = new Map();

  for (const s of samples) {
    if (!groups.has(s.toolName)) {
      groups.set(s.toolName, []);
    }
    groups.get(s.toolName).push(s);
  }

  const perTool = [];
  for (const [toolName, toolSamples] of groups.entries()) {
    const durations = toolSamples
      .map((x) => x.durationMs)
      .filter((v) => Number.isFinite(v) && v >= 0)
      .sort((a, b) => a - b);

    const successCount = toolSamples.filter((x) => x.status === "success").length;
    const errorCount = toolSamples.filter((x) => x.status === "error").length;
    const cacheHits = toolSamples.filter((x) => x.cacheHit === true).length;
    const avgDurationMs = durations.length === 0
      ? 0
      : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

    perTool.push({
      toolName,
      callCount: toolSamples.length,
      successRate: toolSamples.length === 0 ? 0 : Number((successCount / toolSamples.length).toFixed(3)),
      errorCount,
      avgDurationMs,
      p95DurationMs: Math.round(percentile(durations, 95)),
      maxDurationMs: durations.at(-1) ?? 0,
      cacheHitRate: toolSamples.length === 0 ? 0 : Number((cacheHits / toolSamples.length).toFixed(3))
    });
  }

  perTool.sort((a, b) => b.callCount - a.callCount);

  const totalCalls = samples.length;
  const totalErrors = samples.filter((x) => x.status === "error").length;
  const totalSuccess = totalCalls - totalErrors;

  return {
    totalCalls,
    totalErrors,
    overallSuccessRate: totalCalls === 0 ? 0 : Number((totalSuccess / totalCalls).toFixed(3)),
    perTool
  };
}

function readSamples(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`metrics file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed = [];

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (
        typeof row.toolName === "string" &&
        typeof row.durationMs === "number" &&
        typeof row.startedAt === "string" &&
        (row.status === "success" || row.status === "error")
      ) {
        parsed.push({
          toolName: row.toolName,
          durationMs: row.durationMs,
          startedAt: row.startedAt,
          status: row.status,
          cacheHit: row.cacheHit === true
        });
      }
    } catch {
      // malformed line is skipped
    }
  }

  return parsed;
}

function printTable(summary, topN) {
  const rows = summary.perTool.slice(0, topN);
  if (rows.length === 0) {
    console.log("[metrics] valid samples: 0");
    return;
  }

  console.log(`[metrics] totalCalls=${summary.totalCalls} totalErrors=${summary.totalErrors} successRate=${summary.overallSuccessRate}`);
  console.log("toolName\tcalls\tsuccessRate\terrors\tavgMs\tp95Ms\tmaxMs\tcacheHitRate");

  for (const row of rows) {
    console.log(
      `${row.toolName}\t${row.callCount}\t${row.successRate}\t${row.errorCount}\t${row.avgDurationMs}\t${row.p95DurationMs}\t${row.maxDurationMs}\t${row.cacheHitRate}`
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const samples = readSamples(options.file);
    const summary = aggregate(samples);

    if (options.json) {
      console.log(JSON.stringify({ file: options.file, ...summary }, null, 2));
      return;
    }

    console.log(`[metrics] source: ${options.file}`);
    printTable(summary, options.top);
  } catch (error) {
    console.error(`[metrics][ERROR] ${String(error)}`);
    process.exit(1);
  }
}

main();

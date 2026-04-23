#!/usr/bin/env node
/**
 * seed-metrics.js
 *
 * CI/開発環境向けに、metrics-samples.jsonl へサンプルデータを生成します。
 *
 * 実行例:
 *   npm run metrics:seed
 *   npm run metrics:seed -- --days 30 --records-per-day 20
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_FILE = process.env.SF_AI_METRICS_FILE
  ? resolve(process.env.SF_AI_METRICS_FILE)
  : join(ROOT, "outputs", "events", "metrics-samples.jsonl");

function parseArgs(argv) {
  const options = {
    output: DEFAULT_FILE,
    days: 14,
    recordsPerDay: 12,
    reset: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--output" && argv[i + 1]) {
      options.output = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--days" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.min(parsed, 90);
      i += 1;
      continue;
    }
    if (token === "--records-per-day" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) options.recordsPerDay = Math.min(parsed, 500);
      i += 1;
      continue;
    }
    if (token === "--reset") {
      options.reset = true;
    }
  }

  return options;
}

function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickTool(index) {
  const tools = [
    "smart_chat",
    "chat",
    "orchestrate_chat",
    "evaluate_triggers",
    "apply_resource_actions",
    "pr_readiness_check",
    "metrics_summary",
    "deploy_org"
  ];
  return tools[index % tools.length];
}

function generateSamples(days, recordsPerDay) {
  const rows = [];
  const now = Date.now();

  for (let d = days - 1; d >= 0; d -= 1) {
    const dayBase = now - d * 24 * 60 * 60 * 1000;
    for (let i = 0; i < recordsPerDay; i += 1) {
      const toolName = pickTool(i + d);
      const seed = hashText(`${toolName}:${d}:${i}`);
      const msInDay = (i * 3600 * 1000 + (seed % 1800000)) % (24 * 60 * 60 * 1000);
      const startedAt = new Date(dayBase + msInDay).toISOString();

      const base = 30 + (seed % 90);
      const burst = seed % 25 === 0 ? 180 + (seed % 160) : 0;
      const durationMs = base + burst;
      const isError = seed % 17 === 0;

      rows.push({
        toolName,
        traceId: `seed-${d}-${i}-${seed}`,
        startedAt,
        durationMs,
        status: isError ? "error" : "success",
        cacheHit: seed % 5 === 0
      });
    }
  }

  rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return rows;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(options.output), { recursive: true });

  const generated = generateSamples(options.days, options.recordsPerDay);
  let existingLines = [];

  if (!options.reset && existsSync(options.output)) {
    existingLines = readFileSync(options.output, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
  }

  const payload = generated.map((x) => JSON.stringify(x));
  const merged = [...existingLines, ...payload].join("\n");
  writeFileSync(options.output, merged.length > 0 ? `${merged}\n` : "", "utf-8");

  console.log(`[metrics-seed] wrote ${generated.length} samples to ${options.output}`);
  console.log(`[metrics-seed] days=${options.days} recordsPerDay=${options.recordsPerDay} reset=${options.reset}`);
}

try {
  main();
} catch (error) {
  console.error(`[metrics-seed][ERROR] ${String(error)}`);
  process.exit(1);
}

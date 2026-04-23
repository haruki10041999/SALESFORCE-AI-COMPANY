#!/usr/bin/env node
/**
 * init-config.js
 *
 * outputs/ 配下の初期ディレクトリ構造を作成します。
 * 実行: npm run init  または  node scripts/init-config.js
 *
 * 環境変数 SF_AI_OUTPUTS_DIR を設定すると出力先を変更できます。
 * 例: SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs node scripts/init-config.js
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

const SUBDIRS = [
  "history",
  "presets",
  "sessions",
  "events",
  "tool-proposals",
  "custom-tools",
];

console.log(`[init-config] outputs dir: ${OUTPUTS_DIR}`);

for (const sub of SUBDIRS) {
  const dir = join(OUTPUTS_DIR, sub);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`  created: ${dir}`);
  } else {
    console.log(`  exists:  ${dir}`);
  }
}

const governanceFile = join(OUTPUTS_DIR, "resource-governance.json");
if (!existsSync(governanceFile)) {
  const initial = {
    config: {
      maxCounts: { skills: 30, tools: 40, presets: 20 },
      thresholds: { minUsageToKeep: 2, bugSignalToFlag: 2 },
      resourceLimits: { creationsPerDay: 5, deletionsPerDay: 3 },
      toolExecution: {
        retryEnabled: true,
        maxRetries: 2,
        baseDelayMs: 150,
        maxDelayMs: 2000,
        retryablePatterns: ["timeout", "econnreset", "econnrefused", "503", "429"],
        retryableCodes: ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "429", "503", "504"],
      },
      eventAutomation: {
        enabled: true,
        protectedTools: [
          "apply_resource_actions",
          "get_resource_governance",
          "review_resource_governance",
          "record_resource_signal",
          "get_system_events",
          "get_event_automation_config",
          "update_event_automation_config",
        ],
        rules: {
          errorAggregateDetected: { autoDisableTool: true },
          governanceThresholdExceeded: { autoDisableRecommendedTools: false, maxToolsPerRun: 3 },
        },
      },
    },
    usage: { skills: {}, tools: {}, presets: {} },
    bugSignals: { skills: {}, tools: {}, presets: {} },
    disabled: { skills: [], tools: [], presets: [] },
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(governanceFile, JSON.stringify(initial, null, 2), "utf-8");
  console.log(`  created: ${governanceFile}`);
} else {
  console.log(`  exists:  ${governanceFile}`);
}

console.log("[init-config] done.");

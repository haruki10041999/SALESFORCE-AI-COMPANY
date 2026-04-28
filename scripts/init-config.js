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

import { mkdirSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");
const DIST_SERVER_PATH = join(ROOT, "dist", "mcp", "server.js");
const ENV_TARGET = join(ROOT, ".env");
const LOCAL_ENV_SAMPLE = join(ROOT, ".env.local.sample");
const DEFAULT_ENV_SAMPLE = join(ROOT, ".env.sample");

const SUBDIRS = [
  "history",
  "presets",
  "sessions",
  "events",
  "audit",
  "tool-proposals",
  "custom-tools",
  "dashboards",
  "reports",
  "backups",
  "setup",
];

function normalizePathForJson(pathValue) {
  return pathValue.replaceAll("\\", "/");
}

function ensureFileFromSample(targetPath, primarySample, fallbackSample) {
  if (existsSync(targetPath)) {
    console.log(`  exists:  ${targetPath}`);
    return false;
  }

  const source = existsSync(primarySample)
    ? primarySample
    : fallbackSample;

  copyFileSync(source, targetPath);
  console.log(`  created: ${targetPath} (from ${source})`);
  return true;
}

function writeOpencodeConfig(outputsDir) {
  const setupDir = join(outputsDir, "setup");
  const configPath = join(setupDir, "opencode-mcp.local.json");
  const payload = {
    mcpServers: {
      "salesforce-ai-company": {
        command: "node",
        args: [normalizePathForJson(DIST_SERVER_PATH)],
        cwd: normalizePathForJson(ROOT),
        env: {
          SF_AI_OUTPUTS_DIR: normalizePathForJson(outputsDir)
        }
      }
    }
  };

  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(`  created: ${configPath}`);
  return configPath;
}

function installGitHooks() {
  const installer = join(ROOT, "scripts", "install-git-hooks.js");
  const result = spawnSync(process.execPath, [installer], {
    cwd: ROOT,
    encoding: "utf-8"
  });

  if ((result.status ?? 1) !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || "failed to install git hooks";
    console.warn(`[init-config] WARN: ${message}`);
    return false;
  }

  const lines = `${result.stdout ?? ""}`.trim();
  if (lines) {
    console.log(lines);
  }
  return true;
}

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

const envCreated = ensureFileFromSample(ENV_TARGET, LOCAL_ENV_SAMPLE, DEFAULT_ENV_SAMPLE);

const governanceFile = join(OUTPUTS_DIR, "resource-governance.json");
if (!existsSync(governanceFile)) {
  const initial = {
    config: {
      maxCounts: { skills: 150, tools: 150, presets: 150 },
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

const opencodeConfigPath = writeOpencodeConfig(OUTPUTS_DIR);
installGitHooks();

console.log("[init-config] done.");
console.log("[init-config] next steps:");
console.log("  1. npm run build");
console.log("  2. npm run ai -- doctor");
console.log(`  3. OpenCode MCP config: ${opencodeConfigPath}`);
if (envCreated) {
  console.log("  4. Review .env if you need Ollama / telemetry / shared outputs settings");
}

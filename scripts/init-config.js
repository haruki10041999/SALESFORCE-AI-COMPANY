#!/usr/bin/env node
/**
 * init-config.js
 *
 * outputs/ 配下の初期ディレクトリ構造を作成します。
 * Docker + PostgreSQL のセットアップとDB初期化も行います。
 * 実行: npm run init  または  node scripts/init-config.js
 *
 * 環境変数 SF_AI_OUTPUTS_DIR を設定すると出力先を変更できます。
 * 例: SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs node scripts/init-config.js
 */

import { mkdirSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");
const DIST_SERVER_PATH = join(ROOT, "dist", "mcp", "server.js");
const DOCKER_STARTER_PATH = join(ROOT, "scripts", "start-mcp-with-docker.mjs");
const ENV_TARGET = join(ROOT, ".env");
const LOCAL_ENV_SAMPLE = join(ROOT, ".env.local.sample");
const DEFAULT_ENV_SAMPLE = join(ROOT, ".env.sample");

// NOTE: Postgres ベース設計では outputs フォルダを使用しません
// (すべてのデータは Docker Postgres に保存)
// setup ディレクトリのみ必要（OpenCode MCP config など）
const SUBDIRS = [
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
        args: [
          normalizePathForJson(DOCKER_STARTER_PATH),
          "--",
          "node",
          normalizePathForJson(DIST_SERVER_PATH)
        ],
        cwd: normalizePathForJson(ROOT),
        env: {
          SF_AI_DOCKER_SERVICES: "postgres,ollama",
          SF_AI_WAIT_FOR_PORTS: "5432,11434"
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

function isCommandAvailable(cmd) {
  try {
    if (process.platform === "win32") {
      execSync(`where ${cmd}`, { stdio: "ignore" });
    } else {
      execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/bash" });
    }
    return true;
  } catch {
    return false;
  }
}

function setupDocker() {
  console.log("\n[init-config] Docker セットアップ");

  if (!isCommandAvailable("docker")) {
    console.warn(`  WARN: docker コマンドが見つかりません。スキップします。`);
    console.warn(`       Docker Desktop または Docker Engine をインストールしてください。`);
    return false;
  }

  if (!isCommandAvailable("docker-compose")) {
    console.warn(`  WARN: docker-compose コマンドが見つかりません。スキップします。`);
    return false;
  }

  try {
    console.log("  docker-compose up -d postgres ollama を実行中...");
    execSync("docker-compose up -d postgres ollama", {
      cwd: ROOT,
      stdio: "inherit",
      encoding: "utf-8"
    });
    console.log("  ✓ Docker コンテナを起動しました");

    // ヘルスチェック
    console.log("  Postgres ヘルスチェック中...");
    let retries = 30;
    while (retries > 0) {
      try {
        execSync("docker-compose exec -T postgres pg_isready -U sfai", {
          cwd: ROOT,
          stdio: "ignore"
        });
        console.log("  ✓ Postgres が起動しました");
        return true;
      } catch {
        retries--;
        if (retries % 10 === 0) {
          process.stdout.write(".");
        }
      }
    }

    console.warn("  WARN: Postgres ヘルスチェック タイムアウト");
    return false;
  } catch (error) {
    console.warn(`  WARN: Docker セットアップ失敗: ${String(error)}`);
    return false;
  }
}

function setupDatabase() {
  console.log("\n[init-config] データベース初期化");

  if (!isCommandAvailable("npm")) {
    console.warn(`  WARN: npm コマンドが見つかりません。スキップします。`);
    return false;
  }

  try {
    console.log("  npm run db:migrate を実行中...");
    execSync("npm run db:migrate", {
      cwd: ROOT,
      stdio: "inherit",
      encoding: "utf-8"
    });
    console.log("  ✓ DB スキーマを作成しました");

    console.log("  npm run db:push を実行中...");
    execSync("npm run db:push", {
      cwd: ROOT,
      stdio: "inherit",
      encoding: "utf-8"
    });
    console.log("  ✓ DB スキーマをプッシュしました");

    return true;
  } catch (error) {
    console.warn(`  WARN: DB セットアップ失敗: ${String(error)}`);
    console.warn(`       後でもう一度 'npm run db:migrate' と 'npm run db:push' を実行してください`);
    return false;
  }
}

// ============================================================================
// メイン処理
// ============================================================================

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

// Docker とデータベースのセットアップを試みる
const dockerSetupSuccess = setupDocker();
const dbSetupSuccess = dockerSetupSuccess ? setupDatabase() : false;

console.log("\n[init-config] 完了");
console.log("[init-config] 次のステップ:");
if (!dockerSetupSuccess) {
  console.log("  1. docker compose up -d postgres ollama");
  console.log("  2. npm run db:migrate");
  console.log("  3. npm run db:push");
} else if (!dbSetupSuccess) {
  console.log("  1. npm run db:migrate");
  console.log("  2. npm run db:push");
} else {
  console.log("  1. ✓ Docker と DB はセットアップ済み");
}
console.log("  ─");
console.log("  • npm run build");
console.log("  • npm run ai -- doctor");
console.log(`  • OpenCode MCP config: ${opencodeConfigPath}`);
if (envCreated) {
  console.log("  • .env を確認・編集（DATABASE_URL など）");
}

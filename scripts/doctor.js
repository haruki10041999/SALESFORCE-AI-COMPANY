#!/usr/bin/env node
/**
 * doctor.js
 *
 * outputs/ 配下の運用健全性を診断します。
 * 実行: npm run doctor
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

// .env を読み込んでから環境変数を参照する
function loadEnvFile() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  try {
    const loader = process.loadEnvFile;
    if (typeof loader === "function") {
      loader.call(process, envPath);
    }
  } catch {
    // Node 20.6 未満や読み込み失敗は無視
  }
}
loadEnvFile();

const REQUIRED_DIRS = [
  "history",
  "presets",
  "sessions",
  "events",
  "audit",
  "tool-proposals",
  "custom-tools"
];

const REQUIRED_FILES = ["resource-governance.json"];

function log(status, message) {
  const color = status === "OK" ? "\x1b[32m" : status === "WARN" ? "\x1b[33m" : status === "ERROR" ? "\x1b[31m" : "\x1b[36m";
  const reset = "\x1b[0m";
  console.log(`${color}[doctor][${status}]${reset} ${message}`);
}

function daysAgo(ms) {
  return Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

let hasError = false;
let warningCount = 0;

// ── 1. 環境情報 ──────────────────────────────────────────────
log("INFO", `Node.js ${process.version}`);
log("INFO", `outputs dir: ${OUTPUTS_DIR}`);
log("INFO", `AI_LOW_RELEVANCE_THRESHOLD=${process.env.AI_LOW_RELEVANCE_THRESHOLD ?? process.env.LOW_RELEVANCE_SCORE_THRESHOLD ?? "6"}`);
log("INFO", `AI_PROMPT_CACHE_MAX_ENTRIES=${process.env.AI_PROMPT_CACHE_MAX_ENTRIES ?? process.env.PROMPT_CACHE_MAX_ENTRIES ?? "100"}`);
log("INFO", `AI_PROMPT_CACHE_TTL_SECONDS=${process.env.AI_PROMPT_CACHE_TTL_SECONDS ?? process.env.PROMPT_CACHE_TTL_SECONDS ?? "600"}`);
log("INFO", `AI_LLM_PROVIDER=${process.env.AI_LLM_PROVIDER ?? "ollama"}`);
log("INFO", `OLLAMA_BASE_URL=${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}`);

// ── 2. ビルド成果物チェック ───────────────────────────────────
const distServer = join(ROOT, "dist", "mcp", "server.js");
if (existsSync(distServer)) {
  log("OK", `dist/mcp/server.js が存在します。`);
} else {
  warningCount += 1;
  log("WARN", "dist/mcp/server.js が見つかりません。npm run build を実行してください。");
}

// ── 3. .env チェック ─────────────────────────────────────────
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  log("OK", ".env ファイルが存在します。");
} else {
  warningCount += 1;
  log("WARN", ".env が見つかりません。npm run init で雛形を生成してください。");
}

// ── 4. git hooks チェック ─────────────────────────────────────
const preCommitHook = join(ROOT, ".git", "hooks", "pre-commit");
if (existsSync(preCommitHook)) {
  const hookContent = readFileSync(preCommitHook, "utf-8");
  if (hookContent.includes("salesforce-ai-company")) {
    log("OK", "pre-commit フックが導入されています。");
  } else {
    warningCount += 1;
    log("WARN", "pre-commit フックは存在しますが salesforce-ai-company のフックではありません。");
  }
} else {
  warningCount += 1;
  log("WARN", "pre-commit フックが未導入です。npm run init または npm run hooks:install で導入できます。");
}

// ── 5. outputs/ 構造チェック ──────────────────────────────────
if (!existsSync(OUTPUTS_DIR)) {
  hasError = true;
  log("ERROR", "outputs ディレクトリが存在しません。npm run init を実行してください。");
} else {
  log("OK", "outputs ディレクトリが存在します。");
}

for (const dir of REQUIRED_DIRS) {
  const full = join(OUTPUTS_DIR, dir);
  if (!existsSync(full)) {
    hasError = true;
    log("ERROR", `不足ディレクトリ: ${dir}`);
  } else {
    log("OK", `ディレクトリ存在: ${dir}`);
  }
}

for (const file of REQUIRED_FILES) {
  const full = join(OUTPUTS_DIR, file);
  if (!existsSync(full)) {
    hasError = true;
    log("ERROR", `不足ファイル: ${file}`);
    continue;
  }

  try {
    const parsed = JSON.parse(readFileSync(full, "utf-8"));
    if (!parsed?.config || !parsed?.disabled || !parsed?.usage) {
      hasError = true;
      log("ERROR", `${file} の構造が不正です。`);
    } else {
      log("OK", `${file} のJSON構造は有効です。`);
    }
  } catch (error) {
    hasError = true;
    log("ERROR", `${file} の読み込み/JSON解析に失敗: ${String(error)}`);
  }
}

// Write permission check
try {
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
  const probe = join(OUTPUTS_DIR, `.doctor-write-probe-${Date.now()}.tmp`);
  writeFileSync(probe, "ok", "utf-8");
  unlinkSync(probe);
  log("OK", "outputs ディレクトリへの書き込み権限があります。");
} catch (error) {
  hasError = true;
  log("ERROR", `outputs 書き込み権限がありません: ${String(error)}`);
}

// Session staleness diagnostics
const sessionDir = join(OUTPUTS_DIR, "sessions");
if (existsSync(sessionDir)) {
  const staleThresholdDays = 30;
  let staleCount = 0;
  const files = readdirSync(sessionDir);
  for (const file of files) {
    const full = join(sessionDir, file);
    try {
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      const ageDays = daysAgo(stat.mtimeMs);
      if (ageDays >= staleThresholdDays) {
        staleCount += 1;
      }
    } catch {
      // ignore per-file errors
    }
  }

  if (staleCount > 0) {
    warningCount += 1;
    log("WARN", `sessions に ${staleCount} 件の30日以上古いファイルがあります。`);
  } else {
    log("OK", "sessions に古いファイルは見つかりませんでした。");
  }
}

// ── 6. Ollama 疎通確認 (任意) ─────────────────────────────────
const provider = process.env.AI_LLM_PROVIDER ?? "ollama";
if (provider !== "heuristic") {
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const tagsUrl = `${ollamaUrl}/api/tags`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(tagsUrl, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = Array.isArray(data?.models) ? data.models.map((m) => m?.name ?? m?.model ?? "?") : [];
      log("OK", `Ollama 接続成功: ${tagsUrl} (モデル数: ${models.length}${models.length > 0 ? `, 例: ${models[0]}` : ""})`);
    } else {
      warningCount += 1;
      log("WARN", `Ollama が ${res.status} を返しました。LLM機能は heuristic にフォールバックします。`);
    }
  } catch (error) {
    warningCount += 1;
    const reason = error instanceof Error ? (error.name === "AbortError" ? "タイムアウト (4s)" : error.message) : String(error);
    log("WARN", `Ollama 未起動または接続不可 (${reason})。LLM機能は heuristic にフォールバックします。`);
    log("WARN", "  → Ollama を使用しない場合は .env に AI_LLM_PROVIDER=heuristic を設定してください。");
  }
} else {
  log("INFO", "AI_LLM_PROVIDER=heuristic: Ollama 疎通確認をスキップ。");
}

// ── SUMMARY ──────────────────────────────────────────────────
if (hasError) {
  log("SUMMARY", `診断完了: ERROR あり / WARN ${warningCount} 件`);
  process.exit(1);
}

log("SUMMARY", `診断完了: OK / WARN ${warningCount} 件`);

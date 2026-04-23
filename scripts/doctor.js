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
  console.log(`[doctor][${status}] ${message}`);
}

function daysAgo(ms) {
  return Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

let hasError = false;
let warningCount = 0;

log("INFO", `outputs dir: ${OUTPUTS_DIR}`);

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

if (hasError) {
  log("SUMMARY", `診断完了: ERROR あり / WARN ${warningCount} 件`);
  process.exit(1);
}

log("SUMMARY", `診断完了: OK / WARN ${warningCount} 件`);

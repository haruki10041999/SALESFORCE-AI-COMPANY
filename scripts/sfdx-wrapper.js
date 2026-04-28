#!/usr/bin/env node
/**
 * sfdx-wrapper.js — sf/sfdx CLI の薄いラッパー
 *
 * 使い方:
 *   npm run sf -- <command> [options]
 *   npm run sf -- org:list
 *   npm run sf -- deploy --target-org dev-sandbox
 *   npm run sf -- test    --target-org dev-sandbox
 *   npm run sf -- push    --target-org dev-sandbox
 *   npm run sf -- pull    --target-org dev-sandbox
 *   npm run sf -- open    --target-org dev-sandbox
 *
 * 環境変数:
 *   SF_DEFAULT_ORG   — デフォルトの target-org エイリアス（未指定時のフォールバック）
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// .env 読み込み
function loadEnvFile() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile.call(process, envPath);
    }
  } catch {
    // ignore
  }
}
loadEnvFile();

const BOLD  = "\x1b[1m";
const CYAN  = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";

// ── SF CLI 検出 ───────────────────────────────────────────────
function detectSfCli() {
  for (const bin of ["sf", "sfdx"]) {
    const result = spawnSync(bin, ["--version"], { encoding: "utf-8", shell: true });
    if (result.status === 0) {
      const version = (result.stdout ?? "").split("\n")[0].trim();
      return { bin, version };
    }
  }
  return null;
}

const cli = detectSfCli();
if (!cli) {
  console.error(`${RED}[sf] Salesforce CLI (sf または sfdx) が見つかりません。${RESET}`);
  console.error(`${DIM}  インストール: https://developer.salesforce.com/tools/salesforcecli${RESET}`);
  process.exit(1);
}

// ── コマンドマッピング ────────────────────────────────────────
const DEFAULT_ORG = process.env.SF_DEFAULT_ORG ?? "";
const KNOWN_ALIASES = ["prod", "full-sandbox", "dev-sandbox"];

/**
 * --target-org / -o が引数に含まれているか確認し、
 * なければ SF_DEFAULT_ORG を追加して返す。
 */
function injectDefaultOrg(args) {
  const hasOrg = args.some((a) => a === "--target-org" || a === "-o");
  if (!hasOrg && DEFAULT_ORG) {
    return [...args, "--target-org", DEFAULT_ORG];
  }
  return args;
}

/**
 * エイリアス → sf コマンド配列への変換テーブル。
 * 引数は残り argv を後ろに追加して渡す。
 */
const ALIAS_MAP = {
  "org:list": () => [cli.bin, "org", "list"],
  "org:display": (rest) => [cli.bin, "org", "display", ...injectDefaultOrg(rest)],
  "deploy": (rest) => [
    cli.bin, "project", "deploy", "start",
    ...injectDefaultOrg(rest),
  ],
  "retrieve": (rest) => [
    cli.bin, "project", "retrieve", "start",
    ...injectDefaultOrg(rest),
  ],
  "push": (rest) => [cli.bin, "project", "deploy", "start", ...injectDefaultOrg(rest)],
  "pull": (rest) => [cli.bin, "project", "retrieve", "start", ...injectDefaultOrg(rest)],
  "test": (rest) => [
    cli.bin, "apex", "run", "test",
    "--test-level", "RunLocalTests",
    "--result-format", "human",
    ...injectDefaultOrg(rest),
  ],
  "open": (rest) => [cli.bin, "org", "open", ...injectDefaultOrg(rest)],
  "limits": (rest) => [cli.bin, "org", "display", "--verbose", ...injectDefaultOrg(rest)],
};

// ── ヘルプ ────────────────────────────────────────────────────
function showHelp() {
  console.log();
  console.log(`${BOLD}${CYAN}npm run sf — Salesforce CLI ラッパー${RESET}`);
  console.log(`  ${DIM}CLI: ${cli.version}${RESET}`);
  console.log("─".repeat(56));
  const cmds = [
    ["org:list",     "認証済み org 一覧を表示"],
    ["org:display",  "現在の org の詳細を表示 [-o <alias>]"],
    ["deploy",       "ソースをデプロイ [-o <alias>] [--dry-run]"],
    ["retrieve",     "ソースを取得 [-o <alias>]"],
    ["push",         "Scratch Org へ push (deploy の別名)"],
    ["pull",         "Scratch Org から pull (retrieve の別名)"],
    ["test",         "Apex テストを RunLocalTests で実行 [-o <alias>]"],
    ["open",         "org をブラウザで開く [-o <alias>]"],
    ["limits",       "org の制限情報を表示 [-o <alias>]"],
  ];
  for (const [cmd, desc] of cmds) {
    console.log(`  ${GREEN}${cmd.padEnd(14)}${RESET}${desc}`);
  }
  console.log();
  console.log(`${DIM}SF_DEFAULT_ORG=${DEFAULT_ORG || "(未設定)"}  既定 org エイリアス${RESET}`);
  console.log(`${DIM}既知エイリアス: ${KNOWN_ALIASES.join(", ")}${RESET}`);
  console.log();
}

// ── CLI 実行 ──────────────────────────────────────────────────
function run(argv) {
  console.log(`${DIM}$ ${argv.join(" ")}${RESET}`);
  const [bin, ...args] = argv;
  const result = spawnSync(bin, args, { stdio: "inherit", shell: true });
  return result.status ?? 1;
}

// ── エントリポイント ──────────────────────────────────────────
const [, , command, ...rest] = process.argv;

if (!command || command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

if (command in ALIAS_MAP) {
  const argv = ALIAS_MAP[command](rest);
  const code = run(argv);
  process.exit(code);
}

// 未知のコマンドはそのまま sf/sfdx に転送
const code = run([cli.bin, command, ...rest]);
process.exit(code);

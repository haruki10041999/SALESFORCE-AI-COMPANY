#!/usr/bin/env node
/**
 * cleanup-outputs.js
 *
 * outputs/history と outputs/sessions の古いファイルを削除します。
 * 既定は 30 日より古いファイルを対象にします。
 *
 * 実行例:
 *   npm run outputs:cleanup
 *   npm run outputs:cleanup -- --days 14
 *   npm run outputs:cleanup -- --dry-run
 */

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

function parseArgs(argv) {
  const result = {
    days: 30,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--days" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        result.days = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      result.dryRun = true;
    }
  }

  return result;
}

function ageDays(mtimeMs) {
  return Math.floor((Date.now() - mtimeMs) / (24 * 60 * 60 * 1000));
}

function cleanupDirectory(dirPath, thresholdDays, dryRun) {
  if (!existsSync(dirPath)) {
    return { scanned: 0, removed: 0, skippedMissing: true };
  }

  const names = readdirSync(dirPath);
  let scanned = 0;
  let removed = 0;

  for (const name of names) {
    const filePath = join(dirPath, name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    scanned += 1;
    const days = ageDays(stat.mtimeMs);
    if (days < thresholdDays) {
      continue;
    }

    if (dryRun) {
      console.log(`[cleanup][dry-run] remove ${filePath} (age=${days}d)`);
      removed += 1;
      continue;
    }

    try {
      unlinkSync(filePath);
      console.log(`[cleanup][removed] ${filePath} (age=${days}d)`);
      removed += 1;
    } catch (error) {
      console.warn(`[cleanup][warn] failed to remove ${filePath}: ${String(error)}`);
    }
  }

  return { scanned, removed, skippedMissing: false };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = [
    join(OUTPUTS_DIR, "history"),
    join(OUTPUTS_DIR, "sessions")
  ];

  console.log(`[cleanup] outputs dir: ${OUTPUTS_DIR}`);
  console.log(`[cleanup] threshold days: ${options.days}`);
  console.log(`[cleanup] dry-run: ${options.dryRun}`);

  let totalScanned = 0;
  let totalRemoved = 0;

  for (const dirPath of targets) {
    const result = cleanupDirectory(dirPath, options.days, options.dryRun);
    if (result.skippedMissing) {
      console.log(`[cleanup][skip] missing directory: ${dirPath}`);
      continue;
    }

    totalScanned += result.scanned;
    totalRemoved += result.removed;
    console.log(`[cleanup][summary] ${dirPath} scanned=${result.scanned} removed=${result.removed}`);
  }

  console.log(`[cleanup][done] scanned=${totalScanned} removed=${totalRemoved}`);
}

main();

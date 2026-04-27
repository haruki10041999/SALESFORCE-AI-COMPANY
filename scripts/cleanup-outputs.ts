#!/usr/bin/env tsx
/**
 * cleanup-outputs.ts
 *
 * outputs 配下の再生成しやすい古いファイルを削除します。
 * history / sessions / reports / dashboards / benchmark / debug を再帰 cleanup し、
 * events は rotate 済みの古いログのみ対象にします。
 */

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupOutputs, parseCleanupArgs } from "../mcp/core/governance/outputs-cleanup.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

function main(): void {
  const options = parseCleanupArgs(process.argv.slice(2));

  console.log(`[cleanup] outputs dir: ${OUTPUTS_DIR}`);
  console.log(`[cleanup] threshold days: ${options.days}`);
  console.log(`[cleanup] dry-run: ${options.dryRun}`);

  const summary = cleanupOutputs(OUTPUTS_DIR, options);
  for (const { dirPath, result } of summary.results) {
    if (result.skippedMissing) {
      console.log(`[cleanup][skip] missing directory: ${dirPath}`);
      continue;
    }
    console.log(`[cleanup][summary] ${dirPath} scanned=${result.scanned} removed=${result.removed}`);
  }

  console.log(`[cleanup][done] scanned=${summary.totalScanned} removed=${summary.totalRemoved}`);
}

main();

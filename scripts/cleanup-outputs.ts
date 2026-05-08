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
import { appendFileSync, mkdirSync } from "node:fs";
import {
  cleanupOutputs,
  cleanupOutputsByRetentionPolicy,
  parseCleanupArgs
} from "../mcp/core/governance/outputs-cleanup.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");

function appendCleanupAudit(records: Array<Record<string, unknown>>): void {
  if (records.length === 0) {
    return;
  }
  const auditPath = join(OUTPUTS_DIR, "audit", "retention-cleanup.jsonl");
  mkdirSync(join(OUTPUTS_DIR, "audit"), { recursive: true });
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  appendFileSync(auditPath, `${payload}\n`, "utf-8");
}

function main(): void {
  const options = parseCleanupArgs(process.argv.slice(2));

  console.log(`[cleanup] outputs dir: ${OUTPUTS_DIR}`);
  console.log(`[cleanup] threshold days: ${options.days}`);
  console.log(`[cleanup] dry-run: ${options.dryRun}`);
  console.log(`[cleanup] retention-policy: ${options.useRetentionPolicy === true}`);
  console.log(`[cleanup] audit-log: ${options.auditLog !== false}`);

  if (options.useRetentionPolicy) {
    const summary = cleanupOutputsByRetentionPolicy(OUTPUTS_DIR, options);
    for (const { dirPath, classification, retentionDays, result } of summary.results) {
      if (result.skippedMissing) {
        console.log(`[cleanup][skip] missing directory: ${dirPath}`);
        continue;
      }
      console.log(
        `[cleanup][summary] ${dirPath} classification=${classification} retentionDays=${retentionDays} scanned=${result.scanned} removed=${result.removed}`
      );
    }
    if (options.auditLog !== false) {
      const records = summary.results.flatMap(({ classification, retentionDays, result }) =>
        result.removedFiles.map((item) => ({
          recordedAt: new Date().toISOString(),
          eventType: "retention_cleanup",
          classification,
          retentionDays,
          action: item.action,
          filePath: item.filePath,
          ageDays: item.ageDays,
          dryRun: options.dryRun
        }))
      );
      appendCleanupAudit(records);
    }
    console.log(`[cleanup][done] scanned=${summary.totalScanned} removed=${summary.totalRemoved}`);
    return;
  }

  const summary = cleanupOutputs(OUTPUTS_DIR, options);
  for (const { dirPath, result } of summary.results) {
    if (result.skippedMissing) {
      console.log(`[cleanup][skip] missing directory: ${dirPath}`);
      continue;
    }
    console.log(`[cleanup][summary] ${dirPath} scanned=${result.scanned} removed=${result.removed}`);
  }

  if (options.auditLog !== false) {
    const records = summary.results.flatMap(({ dirPath, result }) =>
      result.removedFiles.map((item) => ({
        recordedAt: new Date().toISOString(),
        eventType: "outputs_cleanup",
        scope: dirPath,
        thresholdDays: options.days,
        action: item.action,
        filePath: item.filePath,
        ageDays: item.ageDays,
        dryRun: options.dryRun
      }))
    );
    appendCleanupAudit(records);
  }

  console.log(`[cleanup][done] scanned=${summary.totalScanned} removed=${summary.totalRemoved}`);
}

main();

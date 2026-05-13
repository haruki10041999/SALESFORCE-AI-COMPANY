#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listSnapshots } from "../../mcp/core/governance/outputs-versioning.js";
import { getOutputsDir } from "../../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../../mcp/core/persistence/atomic-file.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

export interface VerifyBackupOptions {
  snapshot?: string;
  minEntries: number;
  outputsDir: string;
  reportPath: string;
}

export interface VerifyBackupReport {
  executedAt: string;
  ok: boolean;
  snapshot?: string;
  availableSnapshots: number;
  entryCount?: number;
  issues: string[];
}

export function parseVerifyBackupArgs(argv: string[]): VerifyBackupOptions {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      "min-entries": { type: "string" },
      "outputs-dir": { type: "string" },
      "report-path": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  const outputsDir = values["outputs-dir"]?.trim() || resolve(ROOT, getOutputsDir("outputs"));
  const minEntriesRaw = Number.parseInt(values["min-entries"] ?? "1", 10);
  return {
    snapshot: values.snapshot?.trim(),
    minEntries: Number.isFinite(minEntriesRaw) && minEntriesRaw > 0 ? minEntriesRaw : 1,
    outputsDir,
    reportPath: values["report-path"]?.trim() || join(outputsDir, "reports", "backup-verify-latest.json")
  };
}

export async function runVerifyBackup(options: VerifyBackupOptions): Promise<VerifyBackupReport> {
  const backupsDir = join(options.outputsDir, "backups");
  const snapshots = listSnapshots(backupsDir);
  const issues: string[] = [];

  if (snapshots.length === 0) {
    issues.push("no snapshots found in outputs/backups");
  }

  const target = options.snapshot
    ? snapshots.find((snapshot) => snapshot.id === options.snapshot)
    : snapshots[0];

  if (options.snapshot && !target) {
    issues.push(`snapshot not found: ${options.snapshot}`);
  }

  if (target) {
    if (target.entryCount < options.minEntries) {
      issues.push(`snapshot entryCount is too small: ${target.entryCount} < ${options.minEntries}`);
    }

    const metaPath = join(target.path, "_meta.json");
    if (!existsSync(metaPath)) {
      issues.push("snapshot metadata (_meta.json) is missing");
    } else {
      try {
        const parsed = JSON.parse(readFileSync(metaPath, "utf-8")) as {
          createdAt?: string;
          sourceOutputsDir?: string;
          entries?: unknown[];
        };
        if (!parsed.createdAt) {
          issues.push("snapshot metadata missing createdAt");
        }
        if (!parsed.sourceOutputsDir) {
          issues.push("snapshot metadata missing sourceOutputsDir");
        }
        if (!Array.isArray(parsed.entries)) {
          issues.push("snapshot metadata missing entries array");
        }
      } catch {
        issues.push("snapshot metadata is not valid JSON");
      }
    }
  }

  const report: VerifyBackupReport = {
    executedAt: new Date().toISOString(),
    ok: issues.length === 0,
    snapshot: target?.id,
    availableSnapshots: snapshots.length,
    entryCount: target?.entryCount,
    issues
  };

  await writeTextFileAtomic(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main(): Promise<void> {
  const options = parseVerifyBackupArgs(process.argv.slice(2));
  const report = await runVerifyBackup(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

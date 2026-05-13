#!/usr/bin/env tsx
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot
} from "../../mcp/core/governance/outputs-versioning.js";
import { getOutputsDir } from "../../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../../mcp/core/persistence/atomic-file.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

export interface DrRestoreOptions {
  snapshot: string;
  dryRun: boolean;
  skipPreBackup: boolean;
  outputsDir: string;
  reportPath: string;
}

export interface DrRestoreReport {
  executedAt: string;
  dryRun: boolean;
  snapshot: string;
  preBackupSnapshot?: string;
  restoredEntries: string[];
  outputsDir: string;
}

export function parseDrRestoreArgs(argv: string[]): DrRestoreOptions {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "skip-pre-backup": { type: "boolean", default: false },
      "outputs-dir": { type: "string" },
      "report-path": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  const outputsDir = values["outputs-dir"]?.trim() || resolve(ROOT, getOutputsDir("outputs"));
  const reportPath = values["report-path"]?.trim() || join(outputsDir, "reports", "dr-restore-latest.json");
  const snapshot = values.snapshot?.trim() || "";

  if (!snapshot) {
    throw new Error("--snapshot <name> is required");
  }

  return {
    snapshot,
    dryRun: values["dry-run"],
    skipPreBackup: values["skip-pre-backup"],
    outputsDir,
    reportPath
  };
}

export async function runDrRestore(options: DrRestoreOptions): Promise<DrRestoreReport> {
  const backupsDir = join(options.outputsDir, "backups");
  const snapshots = listSnapshots(backupsDir);
  if (!snapshots.some((snapshot) => snapshot.id === options.snapshot)) {
    throw new Error(`snapshot not found: ${options.snapshot}`);
  }

  let preBackupSnapshot: string | undefined;
  if (!options.skipPreBackup) {
    const snapshotName = `pre-restore-${new Date().toISOString().replace(/[.:]/g, "-")}`;
    const created = createSnapshot(options.outputsDir, backupsDir, snapshotName, options.dryRun);
    preBackupSnapshot = created.id;
  }

  const restored = restoreSnapshot(options.outputsDir, backupsDir, options.snapshot, options.dryRun);
  const report: DrRestoreReport = {
    executedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    snapshot: options.snapshot,
    preBackupSnapshot,
    restoredEntries: restored.restoredEntries,
    outputsDir: options.outputsDir
  };

  await writeTextFileAtomic(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main(): Promise<void> {
  const options = parseDrRestoreArgs(process.argv.slice(2));
  const report = await runDrRestore(options);
  console.log(JSON.stringify(report, null, 2));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

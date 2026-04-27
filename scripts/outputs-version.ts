#!/usr/bin/env tsx
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSnapshot,
  listSnapshots,
  parseOutputsVersioningArgs,
  pruneSnapshots,
  restoreSnapshot,
  wipeOutputs
} from "../mcp/core/governance/outputs-versioning.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");
const BACKUPS_DIR = process.env.SF_AI_OUTPUTS_BACKUP_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_BACKUP_DIR)
  : join(OUTPUTS_DIR, "backups");

function printUsage(error?: string): void {
  if (error) {
    console.error(`[outputs:version] ${error}`);
    console.error("");
  }

  console.error("Usage:");
  console.error("  npm run outputs:version -- backup [--name <snapshot>] [--keep <n>] [--dry-run]");
  console.error("  npm run outputs:version -- list");
  console.error("  npm run outputs:version -- restore --snapshot <snapshot> [--skip-pre-backup] [--dry-run]");
  console.error("  npm run outputs:version -- prune [--keep <n>] [--dry-run]");
  console.error("  npm run outputs:version -- wipe [--skip-pre-backup] [--keep-backups] [--name <snapshot>] [--dry-run]");
}

function run(): number {
  let options;
  try {
    options = parseOutputsVersioningArgs(process.argv.slice(2));
  } catch (error) {
    printUsage(String(error));
    return 1;
  }

  console.log(`[outputs:version] outputs dir: ${OUTPUTS_DIR}`);
  console.log(`[outputs:version] backups dir: ${BACKUPS_DIR}`);
  console.log(`[outputs:version] command: ${options.command}`);
  console.log(`[outputs:version] dry-run: ${options.dryRun}`);

  try {
    if (options.command === "list") {
      const snapshots = listSnapshots(BACKUPS_DIR);
      if (snapshots.length === 0) {
        console.log("[outputs:version] snapshot は存在しません。");
        return 0;
      }

      for (const snapshot of snapshots) {
        console.log(
          `[outputs:version][snapshot] id=${snapshot.id} createdAt=${snapshot.createdAt} entries=${snapshot.entryCount}`
        );
      }
      return 0;
    }

    if (options.command === "backup") {
      const snapshot = createSnapshot(OUTPUTS_DIR, BACKUPS_DIR, options.snapshotName!, options.dryRun);
      console.log(
        `[outputs:version][backup] id=${snapshot.id} entries=${snapshot.entryCount} createdAt=${snapshot.createdAt}`
      );

      const pruned = pruneSnapshots(BACKUPS_DIR, options.keep, options.dryRun);
      if (pruned.removed.length > 0) {
        console.log(`[outputs:version][prune] removed=${pruned.removed.join(",")}`);
      }
      return 0;
    }

    if (options.command === "prune") {
      const pruned = pruneSnapshots(BACKUPS_DIR, options.keep, options.dryRun);
      console.log(`[outputs:version][prune] kept=${pruned.kept.length} removed=${pruned.removed.length}`);
      if (pruned.removed.length > 0) {
        console.log(`[outputs:version][prune] removed=${pruned.removed.join(",")}`);
      }
      return 0;
    }

    if (options.command === "wipe") {
      if (!options.skipPreBackup) {
        const preWipe = createSnapshot(OUTPUTS_DIR, BACKUPS_DIR, options.snapshotName!, options.dryRun);
        console.log(`[outputs:version][pre-wipe-backup] id=${preWipe.id} entries=${preWipe.entryCount}`);
        const pruned = pruneSnapshots(BACKUPS_DIR, options.keep, options.dryRun);
        if (pruned.removed.length > 0) {
          console.log(`[outputs:version][prune] removed=${pruned.removed.join(",")}`);
        }
      }

      const wiped = wipeOutputs(OUTPUTS_DIR, BACKUPS_DIR, options.dryRun);
      console.log(`[outputs:version][wipe] removedEntries=${wiped.removedEntries.length} keepBackups=${options.keepBackups}`);
      if (wiped.removedEntries.length > 0) {
        console.log(`[outputs:version][wipe] removed=${wiped.removedEntries.join(",")}`);
      }
      return 0;
    }

    if (!options.skipPreBackup) {
      const preRestore = createSnapshot(
        OUTPUTS_DIR,
        BACKUPS_DIR,
        `pre-restore-${new Date().toISOString().replace(/[.:]/g, "-")}`,
        options.dryRun
      );
      console.log(`[outputs:version][pre-restore-backup] id=${preRestore.id} entries=${preRestore.entryCount}`);
      const pruned = pruneSnapshots(BACKUPS_DIR, options.keep, options.dryRun);
      if (pruned.removed.length > 0) {
        console.log(`[outputs:version][prune] removed=${pruned.removed.join(",")}`);
      }
    }

    const restored = restoreSnapshot(OUTPUTS_DIR, BACKUPS_DIR, options.snapshotName!, options.dryRun);
    console.log(
      `[outputs:version][restore] snapshot=${options.snapshotName} restoredEntries=${restored.restoredEntries.length}`
    );
    return 0;
  } catch (error) {
    console.error(`[outputs:version] failed: ${String(error)}`);
    return 1;
  }
}

process.exit(run());

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type CleanupOptions = {
  days: number;
  dryRun: boolean;
};

export type CleanupDirectoryResult = {
  scanned: number;
  removed: number;
  skippedMissing: boolean;
};

export type CleanupSummary = {
  outputsDir: string;
  thresholdDays: number;
  dryRun: boolean;
  totalScanned: number;
  totalRemoved: number;
  results: Array<{ dirPath: string; result: CleanupDirectoryResult }>;
};

export function parseCleanupArgs(argv: string[]): CleanupOptions {
  const result: CleanupOptions = {
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

function ageDays(mtimeMs: number): number {
  return Math.floor((Date.now() - mtimeMs) / (24 * 60 * 60 * 1000));
}

export function cleanupDirectory(dirPath: string, thresholdDays: number, dryRun: boolean): CleanupDirectoryResult {
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

export function cleanupOutputs(outputsDir: string, options: CleanupOptions): CleanupSummary {
  const targets = [
    join(outputsDir, "history"),
    join(outputsDir, "sessions")
  ];

  let totalScanned = 0;
  let totalRemoved = 0;
  const results: Array<{ dirPath: string; result: CleanupDirectoryResult }> = [];

  for (const dirPath of targets) {
    const result = cleanupDirectory(dirPath, options.days, options.dryRun);
    if (!result.skippedMissing) {
      totalScanned += result.scanned;
      totalRemoved += result.removed;
    }
    results.push({ dirPath, result });
  }

  return {
    outputsDir,
    thresholdDays: options.days,
    dryRun: options.dryRun,
    totalScanned,
    totalRemoved,
    results
  };
}

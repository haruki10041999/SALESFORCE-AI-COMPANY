import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("OutputsCleanup");
const PROTECTED_EVENT_FILES = new Set(["system-events.jsonl", "trace-log.jsonl", "metrics-samples.jsonl"]);

type CleanupTarget = {
  dirPath: string;
  recursive?: boolean;
  keepFile?: (filePath: string, dirPath: string) => boolean;
};

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

function listFiles(dirPath: string, recursive: boolean): string[] {
  const names = readdirSync(dirPath);
  const files: string[] = [];

  for (const name of names) {
    const filePath = join(dirPath, name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    if (stat.isFile()) {
      files.push(filePath);
      continue;
    }

    if (recursive && stat.isDirectory()) {
      files.push(...listFiles(filePath, true));
    }
  }

  return files;
}

function keepEventFile(filePath: string, dirPath: string): boolean {
  const rel = relative(dirPath, filePath);
  return !rel.includes("/") && !rel.includes("\\") && PROTECTED_EVENT_FILES.has(basename(filePath));
}

export function cleanupDirectory(
  dirPath: string,
  thresholdDays: number,
  dryRun: boolean,
  target: Pick<CleanupTarget, "recursive" | "keepFile"> = {}
): CleanupDirectoryResult {
  if (!existsSync(dirPath)) {
    return { scanned: 0, removed: 0, skippedMissing: true };
  }

  const files = listFiles(dirPath, target.recursive ?? false);
  let scanned = 0;
  let removed = 0;

  for (const filePath of files) {
    if (target.keepFile?.(filePath, dirPath)) {
      continue;
    }

    scanned += 1;
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    const days = ageDays(stat.mtimeMs);
    if (days < thresholdDays) {
      continue;
    }

    if (dryRun) {
      console.error(`[cleanup][dry-run] remove ${filePath} (age=${days}d)`);
      removed += 1;
      continue;
    }

    try {
      unlinkSync(filePath);
      console.error(`[cleanup][removed] ${filePath} (age=${days}d)`);
      removed += 1;
    } catch (error) {
      logger.warn("failed to remove file", { filePath, error: String(error) });
    }
  }

  return { scanned, removed, skippedMissing: false };
}

export function cleanupOutputs(outputsDir: string, options: CleanupOptions): CleanupSummary {
  const targets: CleanupTarget[] = [
    { dirPath: join(outputsDir, "history"), recursive: true },
    { dirPath: join(outputsDir, "sessions"), recursive: true },
    { dirPath: join(outputsDir, "reports"), recursive: true },
    { dirPath: join(outputsDir, "dashboards"), recursive: true },
    { dirPath: join(outputsDir, "benchmark"), recursive: true },
    { dirPath: join(outputsDir, "debug"), recursive: true },
    { dirPath: join(outputsDir, "events"), keepFile: keepEventFile }
  ];

  let totalScanned = 0;
  let totalRemoved = 0;
  const results: Array<{ dirPath: string; result: CleanupDirectoryResult }> = [];

  for (const target of targets) {
    const result = cleanupDirectory(target.dirPath, options.days, options.dryRun, target);
    if (!result.skippedMissing) {
      totalScanned += result.scanned;
      totalRemoved += result.removed;
    }
    results.push({ dirPath: target.dirPath, result });
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

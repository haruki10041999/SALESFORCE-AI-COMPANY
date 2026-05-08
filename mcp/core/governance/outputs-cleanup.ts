import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../logging/logger.js";
import {
  buildDataRetentionPolicy,
  resolveRetentionTargets,
  type DataClassificationLabel
} from "./data-retention.js";

const logger = createLogger("OutputsCleanup");

type CleanupTarget = {
  dirPath: string;
  recursive?: boolean;
};

export type CleanupOptions = {
  days: number;
  dryRun: boolean;
  useRetentionPolicy?: boolean;
  auditLog?: boolean;
};

export type CleanupRemovedFile = {
  filePath: string;
  ageDays: number;
  action: "removed" | "dry-run";
};

export type CleanupDirectoryResult = {
  scanned: number;
  removed: number;
  skippedMissing: boolean;
  removedFiles: CleanupRemovedFile[];
};

export type CleanupSummary = {
  outputsDir: string;
  thresholdDays: number;
  dryRun: boolean;
  totalScanned: number;
  totalRemoved: number;
  results: Array<{ dirPath: string; result: CleanupDirectoryResult }>;
};

export type RetentionCleanupSummary = {
  outputsDir: string;
  dryRun: boolean;
  totalScanned: number;
  totalRemoved: number;
  results: Array<{
    dirPath: string;
    classification: DataClassificationLabel;
    retentionDays: number;
    result: CleanupDirectoryResult;
  }>;
};

export function parseCleanupArgs(argv: string[]): CleanupOptions {
  const result: CleanupOptions = {
    days: 30,
    dryRun: false,
    useRetentionPolicy: false,
    auditLog: true
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
    if (token === "--retention-policy") {
      result.useRetentionPolicy = true;
    }
    if (token === "--no-audit-log") {
      result.auditLog = false;
    }
    if (token === "--audit-log") {
      result.auditLog = true;
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

export function cleanupDirectory(
  dirPath: string,
  thresholdDays: number,
  dryRun: boolean,
  target: Pick<CleanupTarget, "recursive"> = {}
): CleanupDirectoryResult {
  if (!existsSync(dirPath)) {
    return { scanned: 0, removed: 0, skippedMissing: true, removedFiles: [] };
  }

  const files = listFiles(dirPath, target.recursive ?? false);
  let scanned = 0;
  let removed = 0;
  const removedFiles: CleanupRemovedFile[] = [];

  for (const filePath of files) {
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
      removedFiles.push({ filePath, ageDays: days, action: "dry-run" });
      continue;
    }

    try {
      unlinkSync(filePath);
      console.error(`[cleanup][removed] ${filePath} (age=${days}d)`);
      removed += 1;
      removedFiles.push({ filePath, ageDays: days, action: "removed" });
    } catch (error) {
      logger.warn("failed to remove file", { filePath, error: String(error) });
    }
  }

  return { scanned, removed, skippedMissing: false, removedFiles };
}

export function cleanupOutputs(outputsDir: string, options: CleanupOptions): CleanupSummary {
  const targets: CleanupTarget[] = [
    { dirPath: join(outputsDir, "history"), recursive: true },
    { dirPath: join(outputsDir, "sessions"), recursive: true },
    { dirPath: join(outputsDir, "reports"), recursive: true },
    { dirPath: join(outputsDir, "dashboards"), recursive: true },
    { dirPath: join(outputsDir, "benchmark"), recursive: true },
    { dirPath: join(outputsDir, "debug"), recursive: true }
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

export function cleanupOutputsByRetentionPolicy(
  outputsDir: string,
  options: Pick<CleanupOptions, "dryRun">,
  env: NodeJS.ProcessEnv = process.env
): RetentionCleanupSummary {
  const policy = buildDataRetentionPolicy(env);
  const targets = resolveRetentionTargets(policy).map((target) => ({
    dirPath: join(outputsDir, target.relativeDir),
    recursive: target.recursive,
    classification: target.classification,
    retentionDays: target.retentionDays
  }));

  let totalScanned = 0;
  let totalRemoved = 0;
  const results: RetentionCleanupSummary["results"] = [];

  for (const target of targets) {
    const result = cleanupDirectory(target.dirPath, target.retentionDays, options.dryRun, target);
    if (!result.skippedMissing) {
      totalScanned += result.scanned;
      totalRemoved += result.removed;
    }
    results.push({
      dirPath: target.dirPath,
      classification: target.classification,
      retentionDays: target.retentionDays,
      result
    });
  }

  return {
    outputsDir,
    dryRun: options.dryRun,
    totalScanned,
    totalRemoved,
    results
  };
}

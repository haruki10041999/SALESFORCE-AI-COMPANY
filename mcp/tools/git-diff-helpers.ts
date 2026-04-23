import { execFileSync } from "node:child_process";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

export type DiffStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X" | "B";

export type DiffFile = {
  path: string;
  status: DiffStatus;
  additions: number;
  deletions: number;
  oldPath?: string;
};

export function runGit(repoPath: string, args: string[]): string {
  const repoCheck = runSchemaValidation(SafeFilePathSchema, repoPath);
  if (!repoCheck.success) {
    throw new Error(`Invalid repoPath: ${repoCheck.errors.join(", ")}`);
  }
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git command failed (${args.join(" ")}): ${message}`);
  }
}

export function validateRef(ref: string, fieldName: string): void {
  if (!ref || ref.startsWith("-") || !/^[A-Za-z0-9._/\-]+$/.test(ref)) {
    throw new Error(`Invalid ${fieldName}: ${ref}`);
  }
}

export function ensureGitRepoAndRefs(repoPath: string, refs: string[]): void {
  try {
    runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(`repoPath is not a git repository: ${repoPath}`);
  }

  for (const ref of refs) {
    try {
      runGit(repoPath, ["rev-parse", "--verify", ref]);
    } catch {
      throw new Error(`git ref not found: ${ref}`);
    }
  }
}

function parseNameStatus(output: string): Map<string, { status: DiffStatus; oldPath?: string }> {
  const result = new Map<string, { status: DiffStatus; oldPath?: string }>();

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split("\t");
    const rawStatus = parts[0] ?? "";
    const status = rawStatus[0] as DiffStatus;

    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (newPath) {
        result.set(newPath, { status, oldPath });
      }
      continue;
    }

    const filePath = parts[1];
    if (filePath) {
      result.set(filePath, { status });
    }
  }

  return result;
}

function parseNumStat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split("\t");
    const additions = Number.parseInt(parts[0] ?? "0", 10);
    const deletions = Number.parseInt(parts[1] ?? "0", 10);

    if (parts.length >= 4) {
      const path = parts[3];
      if (path) {
        result.set(path, {
          additions: Number.isNaN(additions) ? 0 : additions,
          deletions: Number.isNaN(deletions) ? 0 : deletions
        });
      }
      continue;
    }

    const path = parts[2];
    if (path) {
      result.set(path, {
        additions: Number.isNaN(additions) ? 0 : additions,
        deletions: Number.isNaN(deletions) ? 0 : deletions
      });
    }
  }

  return result;
}

export function getDiffFiles(repoPath: string, comparison: string): DiffFile[] {
  const nameStatus = parseNameStatus(runGit(repoPath, ["diff", "--name-status", comparison]));
  const numStat = parseNumStat(runGit(repoPath, ["diff", "--numstat", comparison]));

  const files: DiffFile[] = [];

  for (const [path, info] of nameStatus.entries()) {
    const num = numStat.get(path) ?? { additions: 0, deletions: 0 };
    files.push({
      path,
      status: info.status,
      additions: num.additions,
      deletions: num.deletions,
      oldPath: info.oldPath
    });
  }

  files.sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
  return files;
}

export function getFileExtension(path: string): string {
  const index = path.lastIndexOf(".");
  if (index < 0 || index === path.length - 1) return "(no-ext)";
  return path.slice(index + 1).toLowerCase();
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

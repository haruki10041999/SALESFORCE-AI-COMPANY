import { execFileSync } from "node:child_process";

export type BranchDiffInput = {
  repoPath: string;
  integrationBranch: string;
  workingBranch: string;
  maxFiles?: number;
};

export type FileChange = {
  path: string;
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X" | "B";
  additions: number;
  deletions: number;
  touchedSymbols: string[];
};

export type BranchDiffSummary = {
  comparison: string;
  repoPath: string;
  filesChanged: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  copied: number;
  fileTypeBreakdown: Record<string, number>;
  fileChanges: FileChange[];
  summary: string;
};

function runGit(repoPath: string, args: string[]): string {
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

function validateRef(ref: string, fieldName: string): void {
  if (!ref || ref.startsWith("-") || !/^[A-Za-z0-9._/\-]+$/.test(ref)) {
    throw new Error(`Invalid ${fieldName}: ${ref}`);
  }
}

function statusToKey(status: FileChange["status"]): "added" | "modified" | "deleted" | "renamed" | "copied" {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  return "modified";
}

function fileTypeOf(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot < 0 || lastDot === path.length - 1) return "(no-ext)";
  return path.slice(lastDot + 1).toLowerCase();
}

function parseNameStatus(output: string): Map<string, FileChange["status"]> {
  const result = new Map<string, FileChange["status"]>();

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split("\t");
    const rawStatus = parts[0] ?? "";
    const normalizedStatus = rawStatus[0] as FileChange["status"];

    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const newPath = parts[2];
      if (newPath) result.set(newPath, normalizedStatus);
      continue;
    }

    const filePath = parts[1];
    if (filePath) result.set(filePath, normalizedStatus);
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

function parseTouchedSymbolsByFile(output: string): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  let currentPath = "";

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.replace("+++ b/", "").trim();
      if (!result.has(currentPath)) {
        result.set(currentPath, new Set<string>());
      }
      continue;
    }

    if (!line.startsWith("@@") || !currentPath) {
      continue;
    }

    const tail = line.split("@@").slice(2).join("@@").trim();
    if (!tail) continue;

    const cleaned = tail.replace(/^\s+|\s+$/g, "").replace(/^[-+]/, "").trim();
    if (cleaned) {
      result.get(currentPath)?.add(cleaned);
    }
  }

  return new Map([...result.entries()].map(([k, v]) => [k, [...v]]));
}

export function summarizeBranchDiff(input: BranchDiffInput): BranchDiffSummary {
  const { repoPath, integrationBranch, workingBranch, maxFiles = 20 } = input;
  validateRef(integrationBranch, "integrationBranch");
  validateRef(workingBranch, "workingBranch");

  const comparison = `${integrationBranch}...${workingBranch}`;

  try {
    runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(`repoPath is not a git repository: ${repoPath}`);
  }

  try {
    runGit(repoPath, ["rev-parse", "--verify", integrationBranch]);
  } catch {
    throw new Error(`integrationBranch not found: ${integrationBranch}`);
  }

  try {
    runGit(repoPath, ["rev-parse", "--verify", workingBranch]);
  } catch {
    throw new Error(`workingBranch not found: ${workingBranch}`);
  }

  const nameStatus = parseNameStatus(runGit(repoPath, ["diff", "--name-status", comparison]));
  const numStat = parseNumStat(runGit(repoPath, ["diff", "--numstat", comparison]));
  const symbolMap = parseTouchedSymbolsByFile(runGit(repoPath, ["diff", "--unified=0", "--no-color", comparison]));

  const counters = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0
  };

  const fileTypeBreakdown: Record<string, number> = {};
  const fileChanges: FileChange[] = [];

  for (const [path, status] of nameStatus.entries()) {
    const num = numStat.get(path) ?? { additions: 0, deletions: 0 };
    const touchedSymbols = symbolMap.get(path) ?? [];
    counters[statusToKey(status)] += 1;

    const fileType = fileTypeOf(path);
    fileTypeBreakdown[fileType] = (fileTypeBreakdown[fileType] ?? 0) + 1;

    fileChanges.push({
      path,
      status,
      additions: num.additions,
      deletions: num.deletions,
      touchedSymbols
    });
  }

  fileChanges.sort((a, b) => {
    const impactA = a.additions + a.deletions;
    const impactB = b.additions + b.deletions;
    return impactB - impactA;
  });

  const topChanges = fileChanges.slice(0, Math.max(1, maxFiles)).map((f) => {
    const statusLabel =
      f.status === "A" ? "追加" :
      f.status === "M" ? "変更" :
      f.status === "D" ? "削除" :
      f.status === "R" ? "リネーム" :
      f.status === "C" ? "コピー" :
      "変更";

    const symbols = f.touchedSymbols.length > 0
      ? ` / 箇所: ${f.touchedSymbols.slice(0, 2).join(" | ")}`
      : "";

    return `- ${statusLabel}: ${f.path} (+${f.additions} / -${f.deletions})${symbols}`;
  });

  const summaryLines = [
    `比較: ${comparison}`,
    `変更ファイル: ${fileChanges.length}件（追加 ${counters.added} / 変更 ${counters.modified} / 削除 ${counters.deleted} / リネーム ${counters.renamed} / コピー ${counters.copied}）`,
    `対応内容（主要差分）:`,
    ...topChanges
  ];

  return {
    comparison,
    repoPath,
    filesChanged: fileChanges.length,
    added: counters.added,
    modified: counters.modified,
    deleted: counters.deleted,
    renamed: counters.renamed,
    copied: counters.copied,
    fileTypeBreakdown,
    fileChanges,
    summary: summaryLines.join("\n")
  };
}

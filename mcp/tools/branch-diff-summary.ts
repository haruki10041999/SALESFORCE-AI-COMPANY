import {
  ensureGitRepoAndRefs,
  getDiffFiles,
  getFileExtension,
  runGit,
  validateRef
} from "./git-diff-helpers.js";

export type BranchDiffInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
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

function resolveBaseBranch(input: BranchDiffInput): string {
  const branch = input.baseBranch ?? input.integrationBranch;
  if (!branch) {
    throw new Error("baseBranch is required");
  }
  return branch;
}

function statusToKey(status: FileChange["status"]): "added" | "modified" | "deleted" | "renamed" | "copied" {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  return "modified";
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
  const { repoPath, workingBranch, maxFiles = 20 } = input;
  const baseBranch = resolveBaseBranch(input);
  validateRef(baseBranch, "baseBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [baseBranch, workingBranch]);

  const comparison = `${baseBranch}...${workingBranch}`;

  const diffFiles = getDiffFiles(repoPath, comparison);
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

  for (const file of diffFiles) {
    const path = file.path;
    const status = file.status;
    const touchedSymbols = symbolMap.get(path) ?? [];
    counters[statusToKey(status)] += 1;

    const fileType = getFileExtension(path);
    fileTypeBreakdown[fileType] = (fileTypeBreakdown[fileType] ?? 0) + 1;

    fileChanges.push({
      path,
      status,
      additions: file.additions,
      deletions: file.deletions,
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

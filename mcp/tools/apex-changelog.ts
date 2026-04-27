/**
 * TASK-A14: Apex Changelog 生成。
 *
 * 任意の git 比較 (例: `main..HEAD`) を入力に、Apex / LWC / Flow /
 * PermissionSet の変更を分類し、人間向け Markdown changelog として出力する。
 *
 * 設計方針:
 *  - 既存 `git-diff-helpers.ts` を再利用し、git 実行と ref 検証を任せる。
 *  - 分類は path から推測:
 *      classes/         -> Apex Class
 *      triggers/        -> Trigger
 *      lwc/             -> LWC
 *      flows/           -> Flow
 *      permissionsets/  -> Permission Set
 *      その他           -> Other
 *  - status (A/M/D/R) を「追加 / 変更 / 削除 / リネーム」に和訳。
 *  - 各セクションは `additions+deletions` 降順でソート。
 *  - 任意で git log の Conventional Commits 風メッセージから Highlights を抽出。
 *
 * 戻り値は JSON と Markdown の両方を含み、レポート保存先は呼び出し側で制御する。
 */
import { ensureGitRepoAndRefs, getDiffFiles, runGit, validateRef, type DiffFile } from "./git-diff-helpers.js";
import { diffApexSignatures, type ApexSignatureDiffResult } from "../core/apex/signature-diff.js";

export type ChangelogCategory =
  | "Apex Class"
  | "Trigger"
  | "LWC"
  | "Flow"
  | "Permission Set"
  | "Other";

export type ChangelogEntry = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "other";
  additions: number;
  deletions: number;
  category: ChangelogCategory;
  oldPath?: string;
};

export type ApexChangelogInput = {
  repoPath: string;
  baseRef: string;
  headRef?: string;
  /** Maximum number of git log subjects parsed for highlights. Default 50. */
  maxCommits?: number;
  /** Override category detection by extending the path map. */
  categoryOverrides?: Partial<Record<string, ChangelogCategory>>;
  /**
   * TASK-A14: When true, run AST-level signature diff on modified/deleted Apex .cls files
   * and populate `breakingChanges` in the result.
   */
  includeSignatureDiff?: boolean;
};

export type ApexChangelogResult = {
  comparison: string;
  generatedAt: string;
  totalFiles: number;
  byCategory: Record<ChangelogCategory, ChangelogEntry[]>;
  highlights: string[];
  /** TASK-A14: AST-level breaking change summary (populated when includeSignatureDiff=true). */
  breakingChanges?: ApexSignatureDiffResult[];
  markdown: string;
};

const STATUS_MAP: Record<string, ChangelogEntry["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "renamed"
};

const CATEGORY_RULES: Array<{ test: RegExp; category: ChangelogCategory }> = [
  { test: /\/triggers\//i, category: "Trigger" },
  { test: /\/classes\//i, category: "Apex Class" },
  { test: /\/lwc\//i, category: "LWC" },
  { test: /\/flows\//i, category: "Flow" },
  { test: /\.flow(?:-meta\.xml)?$/i, category: "Flow" },
  { test: /\/permissionsets\//i, category: "Permission Set" },
  { test: /\.permissionset-meta\.xml$/i, category: "Permission Set" }
];

function categorize(path: string, overrides?: Partial<Record<string, ChangelogCategory>>): ChangelogCategory {
  if (overrides) {
    for (const [pattern, category] of Object.entries(overrides)) {
      if (category && path.includes(pattern)) return category;
    }
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(path)) return rule.category;
  }
  return "Other";
}

function toEntry(file: DiffFile, overrides?: Partial<Record<string, ChangelogCategory>>): ChangelogEntry {
  return {
    path: file.path,
    status: STATUS_MAP[file.status] ?? "other",
    additions: file.additions,
    deletions: file.deletions,
    category: categorize(file.path, overrides),
    oldPath: file.oldPath
  };
}

const EMPTY_BUCKET: Record<ChangelogCategory, ChangelogEntry[]> = {
  "Apex Class": [],
  "Trigger": [],
  "LWC": [],
  "Flow": [],
  "Permission Set": [],
  "Other": []
};

function bucketise(entries: ChangelogEntry[]): Record<ChangelogCategory, ChangelogEntry[]> {
  const out: Record<ChangelogCategory, ChangelogEntry[]> = {
    "Apex Class": [],
    "Trigger": [],
    "LWC": [],
    "Flow": [],
    "Permission Set": [],
    "Other": []
  };
  for (const entry of entries) out[entry.category].push(entry);
  for (const key of Object.keys(out) as ChangelogCategory[]) {
    out[key].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
  }
  return out;
}

function collectHighlights(repoPath: string, comparison: string, maxCommits: number): string[] {
  let raw: string;
  try {
    raw = runGit(repoPath, ["log", "--pretty=%s", `-n${maxCommits}`, comparison]);
  } catch {
    return [];
  }
  const subjects = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Conventional Commits 風 (feat:/fix:/refactor: etc.) を優先表示
  const conv = subjects.filter((s) => /^(feat|fix|refactor|perf|docs|test|chore|build|ci)(\([^)]+\))?[:!]/i.test(s));
  return (conv.length > 0 ? conv : subjects).slice(0, 10);
}

function statusLabel(status: ChangelogEntry["status"]): string {
  switch (status) {
    case "added":    return "追加";
    case "modified": return "変更";
    case "deleted":  return "削除";
    case "renamed":  return "リネーム";
    default:         return "その他";
  }
}

function renderMarkdown(result: Omit<ApexChangelogResult, "markdown">): string {
  const lines: string[] = [];
  lines.push(`# Apex Changelog`);
  lines.push("");
  lines.push(`- comparison: \`${result.comparison}\``);
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- totalFiles: ${result.totalFiles}`);
  lines.push("");

  if (result.highlights.length > 0) {
    lines.push("## Highlights");
    lines.push("");
    for (const h of result.highlights) lines.push(`- ${h}`);
    lines.push("");
  }

  // TASK-A14: breaking change summary
  if (result.breakingChanges && result.breakingChanges.length > 0) {
    const totalBreaking = result.breakingChanges.reduce((sum, r) => sum + r.breakingCount, 0);
    lines.push(`## Breaking Changes (${totalBreaking})`);
    lines.push("");
    lines.push("| class | kind | detail |");
    lines.push("|---|---|---|");
    for (const r of result.breakingChanges) {
      for (const c of r.changes.filter((ch) => ch.isBreaking)) {
        lines.push(`| [${r.className}](${r.referenceUrl}) | ${c.kind} | ${c.detail} |`);
      }
    }
    lines.push("");
  }

  for (const category of Object.keys(result.byCategory) as ChangelogCategory[]) {
    const entries = result.byCategory[category];
    if (entries.length === 0) continue;
    lines.push(`## ${category} (${entries.length})`);
    lines.push("");
    lines.push("| status | path | +/- |");
    lines.push("|---|---|---|");
    for (const e of entries) {
      const path = e.oldPath ? `${e.oldPath} → ${e.path}` : e.path;
      lines.push(`| ${statusLabel(e.status)} | ${path} | +${e.additions}/-${e.deletions} |`);
    }
    lines.push("");
  }

  if (result.totalFiles === 0) {
    lines.push("(No file changes detected in the given range.)");
  }

  return lines.join("\n");
}

export function generateApexChangelog(input: ApexChangelogInput): ApexChangelogResult {
  validateRef(input.baseRef, "baseRef");
  const headRef = input.headRef ?? "HEAD";
  if (input.headRef) validateRef(input.headRef, "headRef");
  ensureGitRepoAndRefs(input.repoPath, [input.baseRef, headRef]);

  const comparison = `${input.baseRef}..${headRef}`;
  const diffFiles = getDiffFiles(input.repoPath, comparison);
  const entries = diffFiles.map((f) => toEntry(f, input.categoryOverrides));
  const byCategory = bucketise(entries);
  const highlights = collectHighlights(input.repoPath, comparison, input.maxCommits ?? 50);

  // TASK-A14: AST-level signature diff for modified/deleted Apex classes
  let breakingChanges: ApexSignatureDiffResult[] | undefined;
  if (input.includeSignatureDiff) {
    breakingChanges = [];
    const apexEntries = entries.filter(
      (e) => e.category === "Apex Class" && (e.status === "modified" || e.status === "deleted")
    );
    for (const entry of apexEntries) {
      let beforeSrc: string | null = null;
      let afterSrc: string | null = null;
      try {
        beforeSrc = runGit(input.repoPath, ["show", `${input.baseRef}:${entry.path}`]);
      } catch { /* file may not exist in base */ }
      if (entry.status === "modified") {
        try {
          afterSrc = runGit(input.repoPath, ["show", `${headRef}:${entry.path}`]);
        } catch { /* file may not exist in head */ }
      }
      const fileName = entry.path.replace(/^.*[\\/]/, "").replace(/\.cls$/i, "");
      const diff = diffApexSignatures(beforeSrc, afterSrc, fileName);
      if (diff.changes.length > 0) breakingChanges.push(diff);
    }
    if (breakingChanges.length === 0) breakingChanges = undefined;
  }

  const partial: Omit<ApexChangelogResult, "markdown"> = {
    comparison,
    generatedAt: new Date().toISOString(),
    totalFiles: entries.length,
    byCategory,
    highlights,
    breakingChanges
  };

  return { ...partial, markdown: renderMarkdown(partial) };
}

// Visible for tests
export const __testables = {
  categorize,
  bucketise,
  renderMarkdown,
  emptyBucket: EMPTY_BUCKET
};

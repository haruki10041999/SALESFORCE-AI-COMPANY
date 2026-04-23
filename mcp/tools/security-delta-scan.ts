import { ensureGitRepoAndRefs, getDiffFiles, runGit, validateRef } from "./git-diff-helpers.js";

export type SecurityDeltaInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
  workingBranch: string;
  maxFindings?: number;
};

export type SecurityFinding = {
  severity: "high" | "medium";
  filePath: string;
  rule: string;
  detail: string;
};

export type SecurityDeltaResult = {
  comparison: string;
  findings: SecurityFinding[];
  summary: string;
};

function addedLinesFromPatch(patch: string): string[] {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function normalizeForHeuristics(source: string): string {
  // Remove block comments and single-line comments first.
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  // Replace quoted literals to avoid matching risky keywords in text constants.
  return withoutComments
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function scanSecurityDelta(input: SecurityDeltaInput): SecurityDeltaResult {
  const { repoPath, workingBranch, maxFindings = 50 } = input;
  const baseBranch = input.baseBranch ?? input.integrationBranch;
  if (!baseBranch) {
    throw new Error("baseBranch is required");
  }
  validateRef(baseBranch, "baseBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [baseBranch, workingBranch]);

  const comparison = `${baseBranch}...${workingBranch}`;
  const files = getDiffFiles(repoPath, comparison).filter((f) => /\.cls$|\.trigger$|\.js$|\.ts$/i.test(f.path));

  const findings: SecurityFinding[] = [];

  for (const file of files) {
    const patch = runGit(repoPath, ["diff", "--unified=0", "--no-color", comparison, "--", file.path]);
    const addedLines = addedLinesFromPatch(patch);
    const joined = normalizeForHeuristics(addedLines.join("\n"));

    if (/\bwithout\s+sharing\b/i.test(joined)) {
      findings.push({
        severity: "high",
        filePath: file.path,
        rule: "sharing-rule",
        detail: "without sharing が追加されています。権限制御の意図を確認してください。"
      });
    }

    if (/\bDatabase\.query\s*\(/i.test(joined) || /\bDatabase\.countQuery\s*\(/i.test(joined)) {
      findings.push({
        severity: "high",
        filePath: file.path,
        rule: "dynamic-soql",
        detail: "動的SOQL呼び出しが追加されています。バインド変数またはエスケープの検証が必要です。"
      });
    }

    if (/\b(PermissionSetAssignment|UserRecordAccess)\b/i.test(joined)) {
      findings.push({
        severity: "medium",
        filePath: file.path,
        rule: "permission-touch",
        detail: "権限制御に関わる更新が含まれます。運用権限と監査要件を確認してください。"
      });
    }

    const hasDml = /\b(insert|update|upsert|delete)\b/i.test(joined);
    const hasCrudFlsGuard = /stripInaccessible|Schema\.sObjectType|isAccessible\(|isUpdateable\(|isCreateable\(/i.test(joined);
    if (hasDml && !hasCrudFlsGuard && /\.cls$|\.trigger$/i.test(file.path)) {
      findings.push({
        severity: "medium",
        filePath: file.path,
        rule: "crud-fls-check",
        detail: "DML追加が検出されました。CRUD/FLSチェック追加の要否を確認してください。"
      });
    }
  }

  const trimmed = findings.slice(0, Math.max(1, maxFindings));
  const high = trimmed.filter((f) => f.severity === "high").length;
  const medium = trimmed.filter((f) => f.severity === "medium").length;

  const summary = [
    `比較: ${comparison}`,
    `検出件数: ${trimmed.length} (high ${high} / medium ${medium})`,
    trimmed.length === 0 ? "差分上で顕著なセキュリティ懸念は見つかりませんでした。" : "要確認ポイントがあります。"
  ].join("\n");

  return {
    comparison,
    findings: trimmed,
    summary
  };
}

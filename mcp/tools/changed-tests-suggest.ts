import { OrgIdentifierSchema, runSchemaValidation } from "../core/quality/resource-validation.js";
import { ensureGitRepoAndRefs, getDiffFiles, unique, validateRef } from "./git-diff-helpers.js";

export type ChangedTestsSuggestInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
  workingBranch: string;
  targetOrg?: string;
};

export type TestSuggestion = {
  testName: string;
  reason: string;
  priority: "high" | "medium";
};

export type ChangedTestsSuggestResult = {
  comparison: string;
  changedSourceFiles: string[];
  suggestions: TestSuggestion[];
  runCommand?: string;
  summary: string;
};

function classNameFromPath(path: string): string | null {
  const match = path.match(/\/classes\/([^/]+)\.cls$/i);
  return match?.[1] ?? null;
}

export function suggestChangedTests(input: ChangedTestsSuggestInput): ChangedTestsSuggestResult {
  const { repoPath, workingBranch, targetOrg } = input;
  const baseBranch = input.baseBranch ?? input.integrationBranch;
  if (!baseBranch) {
    throw new Error("baseBranch is required");
  }
  if (targetOrg) {
    const orgCheck = runSchemaValidation(OrgIdentifierSchema, targetOrg);
    if (!orgCheck.success) {
      throw new Error(`targetOrg validation failed: ${orgCheck.errors.join(", ")}`);
    }
  }
  validateRef(baseBranch, "baseBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [baseBranch, workingBranch]);

  const comparison = `${baseBranch}...${workingBranch}`;
  const files = getDiffFiles(repoPath, comparison).filter((f) => f.status !== "D");

  const changedSourceFiles = files
    .map((f) => f.path)
    .filter((p) => /\/classes\/.*\.cls$|\/lwc\//i.test(p));

  const suggestions: TestSuggestion[] = [];

  for (const path of changedSourceFiles) {
    if (/\/classes\/.*Test\.cls$/i.test(path)) {
      continue;
    }

    const className = classNameFromPath(path);
    if (className) {
      suggestions.push({
        testName: `${className}Test`,
        reason: `${className}.cls の差分に対応`,
        priority: "high"
      });
      suggestions.push({
        testName: `${className}Tests`,
        reason: `${className}.cls の命名ゆらぎ対策`,
        priority: "medium"
      });
      continue;
    }

    if (/\/lwc\/([^/]+)\//i.test(path)) {
      const lwcName = path.match(/\/lwc\/([^/]+)\//i)?.[1];
      if (lwcName) {
        suggestions.push({
          testName: `${lwcName}ControllerTest`,
          reason: `LWC ${lwcName} のサーバー連携影響を確認`,
          priority: "medium"
        });
      }
    }
  }

  const deduped = unique(suggestions.map((s) => JSON.stringify(s))).map((s) => JSON.parse(s) as TestSuggestion);
  const highPriorityNames = deduped.filter((s) => s.priority === "high").map((s) => s.testName);

  const runCommand = highPriorityNames.length > 0
    ? `sf apex run test ${targetOrg ? `--target-org ${targetOrg} ` : ""}--tests ${unique(highPriorityNames).join(",")}`
    : undefined;

  const summary = [
    `比較: ${comparison}`,
    `候補テスト数: ${deduped.length}`,
    deduped.length > 0
      ? `優先テスト: ${unique(highPriorityNames).join(", ") || "なし"}`
      : "差分から推奨できるテスト候補はありません"
  ].join("\n");

  return {
    comparison,
    changedSourceFiles,
    suggestions: deduped,
    runCommand,
    summary
  };
}

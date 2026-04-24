import { OrgIdentifierSchema, runSchemaValidation } from "../core/quality/resource-validation.js";
import { ensureGitRepoAndRefs, getDiffFiles, runGit, unique, validateRef } from "./git-diff-helpers.js";

export type CoverageEstimateInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
  workingBranch: string;
  targetOrg?: string;
};

export type CoverageConfidence = "high" | "medium" | "low";
export type CoverageHint = "high" | "medium" | "low" | "none";

export type CoverageCandidate = {
  testName: string;
  confidence: CoverageConfidence;
  reason: string;
};

export type CoverageMapping = {
  sourcePath: string;
  sourceName: string;
  sourceType: "apex" | "lwc";
  coverageHint: CoverageHint;
  candidates: CoverageCandidate[];
};

export type CoverageEstimateResult = {
  comparison: string;
  changedSourceFiles: string[];
  mappings: CoverageMapping[];
  overallCoverageHint: CoverageHint;
  recommendedTests: string[];
  runCommand?: string;
  summary: string;
};

function classNameFromPath(path: string): string | null {
  const match = path.match(/\/classes\/([^/]+)\.cls$/i);
  return match?.[1] ?? null;
}

function triggerNameFromPath(path: string): string | null {
  const match = path.match(/\/triggers\/([^/]+)\.trigger$/i);
  return match?.[1] ?? null;
}

function listApexTestFiles(repoPath: string, workingBranch: string): string[] {
  const output = runGit(repoPath, [
    "ls-tree",
    "-r",
    "--name-only",
    workingBranch,
    "--",
    "force-app"
  ]);

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\/classes\/.*Test(s)?\.cls$/i.test(line));
}

function fileContentAtRef(repoPath: string, ref: string, filePath: string): string {
  try {
    return runGit(repoPath, ["show", `${ref}:${filePath}`]);
  } catch {
    return "";
  }
}

function deriveOverallHint(mappings: CoverageMapping[]): CoverageHint {
  if (mappings.length === 0) return "none";
  const hints = mappings.map((m) => m.coverageHint);
  const high = hints.filter((h) => h === "high").length;
  const medium = hints.filter((h) => h === "medium").length;
  if (high === mappings.length) return "high";
  if (high + medium === mappings.length) return "medium";
  if (hints.some((h) => h !== "none")) return "low";
  return "none";
}

function hintFromCandidates(candidates: CoverageCandidate[]): CoverageHint {
  if (candidates.some((c) => c.confidence === "high")) return "high";
  if (candidates.some((c) => c.confidence === "medium")) return "medium";
  if (candidates.length > 0) return "low";
  return "none";
}

export function estimateChangedCoverage(input: CoverageEstimateInput): CoverageEstimateResult {
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
  const changedFiles = getDiffFiles(repoPath, comparison).filter((f) => f.status !== "D");
  const changedSourceFiles = changedFiles
    .map((f) => f.path)
    .filter((p) => (/\/classes\/.*\.cls$|\/triggers\/.*\.trigger$|\/lwc\//i.test(p)) && !/\/classes\/.*Test(s)?\.cls$/i.test(p));

  const apexTestFiles = listApexTestFiles(repoPath, workingBranch);
  const apexTestNames = apexTestFiles
    .map((path) => path.match(/\/classes\/([^/]+)\.cls$/i)?.[1])
    .filter((name): name is string => Boolean(name));

  const mappings: CoverageMapping[] = [];

  for (const sourcePath of changedSourceFiles) {
    if (/\/classes\/.*Test(s)?\.cls$/i.test(sourcePath)) {
      continue;
    }

    if (/\/classes\/.*\.cls$/i.test(sourcePath)) {
      const className = classNameFromPath(sourcePath);
      if (!className) continue;

      const canonical = [`${className}Test`, `${className}Tests`];
      const candidates: CoverageCandidate[] = [];

      for (const testName of apexTestNames) {
        if (canonical.includes(testName)) {
          candidates.push({
            testName,
            confidence: "high",
            reason: `${className} の標準命名テスト`
          });
          continue;
        }

        if (testName.startsWith(className)) {
          candidates.push({
            testName,
            confidence: "medium",
            reason: `${className} 接頭辞に一致`
          });
          continue;
        }

        const matchedPath = apexTestFiles.find((path) => path.endsWith(`/${testName}.cls`));
        if (matchedPath) {
          const content = fileContentAtRef(repoPath, workingBranch, matchedPath);
          if (new RegExp(`\\b${className}\\b`).test(content)) {
            candidates.push({
              testName,
              confidence: "medium",
              reason: `${className} 参照をテスト本文で検出`
            });
          }
        }
      }

      const deduped = unique(candidates.map((c) => JSON.stringify(c))).map((s) => JSON.parse(s) as CoverageCandidate);
      mappings.push({
        sourcePath,
        sourceName: className,
        sourceType: "apex",
        coverageHint: hintFromCandidates(deduped),
        candidates: deduped.slice(0, 5)
      });
      continue;
    }

    if (/\/triggers\/.*\.trigger$/i.test(sourcePath)) {
      const triggerName = triggerNameFromPath(sourcePath);
      if (!triggerName) continue;

      const canonical = [`${triggerName}Test`, `${triggerName}Tests`];
      const candidates: CoverageCandidate[] = [];

      for (const testName of apexTestNames) {
        if (canonical.includes(testName)) {
          candidates.push({
            testName,
            confidence: "high",
            reason: `${triggerName} の標準命名テスト`
          });
          continue;
        }

        if (testName.startsWith(triggerName)) {
          candidates.push({
            testName,
            confidence: "medium",
            reason: `${triggerName} 接頭辞に一致`
          });
          continue;
        }

        const matchedPath = apexTestFiles.find((path) => path.endsWith(`/${testName}.cls`));
        if (matchedPath) {
          const content = fileContentAtRef(repoPath, workingBranch, matchedPath);
          if (new RegExp(`\\b${triggerName}\\b`).test(content)) {
            candidates.push({
              testName,
              confidence: "medium",
              reason: `${triggerName} 参照をテスト本文で検出`
            });
          }
        }
      }

      const deduped = unique(candidates.map((c) => JSON.stringify(c))).map((s) => JSON.parse(s) as CoverageCandidate);
      mappings.push({
        sourcePath,
        sourceName: triggerName,
        sourceType: "apex",
        coverageHint: hintFromCandidates(deduped),
        candidates: deduped.slice(0, 5)
      });
      continue;
    }

    if (/\/lwc\//i.test(sourcePath)) {
      const lwcName = sourcePath.match(/\/lwc\/([^/]+)\//i)?.[1] ?? "unknown-lwc";
      const candidates: CoverageCandidate[] = [
        {
          testName: `${lwcName}ControllerTest`,
          confidence: "low",
          reason: `LWC ${lwcName} と連携する Apex テスト候補`
        }
      ];

      mappings.push({
        sourcePath,
        sourceName: lwcName,
        sourceType: "lwc",
        coverageHint: hintFromCandidates(candidates),
        candidates
      });
    }
  }

  const recommendedTests = unique(
    mappings.flatMap((m) => m.candidates)
      .filter((c) => c.confidence === "high" || c.confidence === "medium")
      .map((c) => c.testName)
  );

  const runCommand = recommendedTests.length > 0
    ? `sf apex run test ${targetOrg ? `--target-org ${targetOrg} ` : ""}--tests ${recommendedTests.join(",")}`
    : undefined;

  const overallCoverageHint = deriveOverallHint(mappings);
  const summary = [
    `比較: ${comparison}`,
    `対象ソース: ${mappings.length}件`,
    `推奨テスト: ${recommendedTests.length}件`,
    `推定カバレッジ: ${overallCoverageHint}`
  ].join("\n");

  return {
    comparison,
    changedSourceFiles,
    mappings,
    overallCoverageHint,
    recommendedTests,
    runCommand,
    summary
  };
}

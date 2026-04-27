import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import {
  estimateChangedCoverage,
  type CoverageEstimateInput,
  type CoverageHint
} from "./coverage-estimate.js";
import {
  scanBranchAndExceptionScaffold,
  type BranchExceptionScaffold
} from "./test-scaffold-extractor.js";

export type AnalyzeTestCoverageGapInput = CoverageEstimateInput & {
  reportOutputDir?: string;
  maxItems?: number;
  /** TASK-A8: enable branch/exception scaffold suggestion per gap. */
  includeBranchScaffold?: boolean;
};

export type CoverageGapItem = {
  sourcePath: string;
  sourceName: string;
  sourceType: "apex";
  predictedCoverageHint: CoverageHint;
  candidateTests: string[];
  reason: string;
  /** TASK-A8: present only when includeBranchScaffold=true and source was readable. */
  branchScaffold?: BranchExceptionScaffold;
};

export type AnalyzeTestCoverageGapResult = {
  comparison: string;
  generatedAt: string;
  analyzedApexSources: number;
  gapCount: number;
  hasCoverageGap: boolean;
  recommendedTests: string[];
  runCommand?: string;
  gaps: CoverageGapItem[];
  reportJsonPath: string;
  reportMarkdownPath: string;
  summary: string;
  ciGate: {
    pass: boolean;
    suggestedExitCode: number;
  };
};

function renderMarkdown(result: AnalyzeTestCoverageGapResult): string {
  const lines: string[] = [];
  lines.push("# Apex Test Coverage Gap Report");
  lines.push("");
  lines.push(`- comparison: ${result.comparison}`);
  lines.push(`- generatedAt: ${result.generatedAt}`);
  lines.push(`- analyzedApexSources: ${result.analyzedApexSources}`);
  lines.push(`- gapCount: ${result.gapCount}`);
  lines.push(`- hasCoverageGap: ${result.hasCoverageGap}`);
  lines.push("");

  if (result.gaps.length === 0) {
    lines.push("No gaps detected in changed Apex classes/triggers.");
    return lines.join("\n");
  }

  lines.push("## Gaps");
  lines.push("");
  lines.push("| source | hint | candidateTests | reason |");
  lines.push("|---|---|---|---|");

  for (const gap of result.gaps) {
    const candidates = gap.candidateTests.length > 0 ? gap.candidateTests.join(", ") : "-";
    lines.push(`| ${gap.sourcePath} | ${gap.predictedCoverageHint} | ${candidates} | ${gap.reason} |`);
  }

  // TASK-A8: branch/exception scaffold suggestions
  const scaffolded = result.gaps.filter((gap) => gap.branchScaffold);
  if (scaffolded.length > 0) {
    lines.push("");
    lines.push("## Suggested Test Scaffolds (branches & exceptions)");
    lines.push("");
    lines.push("| class | branches | catches | thrown types | suggested tests |");
    lines.push("|---|---|---|---|---|");
    for (const gap of scaffolded) {
      const sc = gap.branchScaffold!;
      lines.push(
        `| ${sc.className} | ${sc.branchCount} | ${sc.catchCount} | ${sc.throwTypes.join(", ") || "-"} | ${sc.suggestedTests.join(", ") || "-"} |`
      );
    }
  }

  lines.push("");
  if (result.runCommand) {
    lines.push("## Recommended Command");
    lines.push("");
    lines.push(`- ${result.runCommand}`);
  }

  return lines.join("\n");
}

export async function analyzeTestCoverageGap(input: AnalyzeTestCoverageGapInput): Promise<AnalyzeTestCoverageGapResult> {
  const estimate = estimateChangedCoverage(input);
  const generatedAt = new Date().toISOString();
  const maxItems = Number.isFinite(input.maxItems)
    ? Math.max(1, Math.min(500, Math.floor(input.maxItems as number)))
    : 200;

  const apexMappings = estimate.mappings.filter((mapping) => mapping.sourceType === "apex");

  const gaps = await Promise.all(
    apexMappings
      .filter((mapping) => {
        const hasConfident = mapping.candidates.some((candidate) =>
          candidate.confidence === "high" || candidate.confidence === "medium"
        );
        return !hasConfident;
      })
      .slice(0, maxItems)
      .map<Promise<CoverageGapItem>>(async (mapping) => {
        const base: CoverageGapItem = {
          sourcePath: mapping.sourcePath,
          sourceName: mapping.sourceName,
          sourceType: "apex",
          predictedCoverageHint: mapping.coverageHint,
          candidateTests: mapping.candidates.map((candidate) => candidate.testName),
          reason: mapping.candidates.length === 0
            ? "matching test class was not detected"
            : "only low-confidence candidates were found"
        };

        // TASK-A8: optionally enrich with branch/exception scaffold suggestions.
        if (input.includeBranchScaffold) {
          try {
            const absolute = resolve(input.repoPath, mapping.sourcePath);
            const apexSource = await fsPromises.readFile(absolute, "utf-8");
            base.branchScaffold = scanBranchAndExceptionScaffold(apexSource, mapping.sourceName);
          } catch {
            // Source may be deleted in working tree (rename/delete diff). Skip silently.
          }
        }

        return base;
      })
  );

  const hasCoverageGap = gaps.length > 0;
  const reportDir = resolve(input.reportOutputDir ?? join("outputs", "reports"));
  await fsPromises.mkdir(reportDir, { recursive: true });

  const stamp = generatedAt.replace(/[:.]/g, "-");
  const reportJsonPath = join(reportDir, `coverage-gap-${stamp}.json`);
  const reportMarkdownPath = join(reportDir, `coverage-gap-${stamp}.md`);

  const summary = [
    `comparison: ${estimate.comparison}`,
    `apexSources: ${apexMappings.length}`,
    `gaps: ${gaps.length}`,
    `overallHint: ${estimate.overallCoverageHint}`
  ].join("\n");

  const result: AnalyzeTestCoverageGapResult = {
    comparison: estimate.comparison,
    generatedAt,
    analyzedApexSources: apexMappings.length,
    gapCount: gaps.length,
    hasCoverageGap,
    recommendedTests: estimate.recommendedTests,
    runCommand: estimate.runCommand,
    gaps,
    reportJsonPath,
    reportMarkdownPath,
    summary,
    ciGate: {
      pass: !hasCoverageGap,
      suggestedExitCode: hasCoverageGap ? 1 : 0
    }
  };

  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(reportMarkdownPath, renderMarkdown(result), "utf-8");

  return result;
}

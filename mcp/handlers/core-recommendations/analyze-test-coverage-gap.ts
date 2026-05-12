import { z } from "zod";
import { analyzeTestCoverageGap } from "../../tools/analyze-test-coverage-gap.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineAnalyzeTestCoverageGapDeps extends RegisterGovToolDeps {}

export function defineAnalyzeTestCoverageGapTool(deps: DefineAnalyzeTestCoverageGapDeps): void {
  const { govTool } = deps;

  govTool(
    "analyze_test_coverage_gap",
    {
      title: "テストカバレッジギャップ解析",
      description: "変更Apexクラス/トリガーに対し対応テスト不足を検出し、JSON/Markdownレポートを出力します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string().optional(),
        integrationBranch: z.string().optional(),
        workingBranch: z.string(),
        targetOrg: z.string().optional(),
        reportOutputDir: z.string().optional(),
        maxItems: z.number().int().min(1).max(500).optional(),
        includeBranchScaffold: z.boolean().optional()
      }
    },
    async ({
      repoPath,
      baseBranch,
      integrationBranch,
      workingBranch,
      targetOrg,
      reportOutputDir,
      maxItems,
      includeBranchScaffold
    }: {
      repoPath: string;
      baseBranch?: string;
      integrationBranch?: string;
      workingBranch: string;
      targetOrg?: string;
      reportOutputDir?: string;
      maxItems?: number;
      includeBranchScaffold?: boolean;
    }) => {
      const result = await analyzeTestCoverageGap({
        repoPath,
        baseBranch,
        integrationBranch,
        workingBranch,
        targetOrg,
        reportOutputDir,
        maxItems,
        includeBranchScaffold
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

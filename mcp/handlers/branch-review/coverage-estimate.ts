import { z } from "zod";
import { estimateChangedCoverage } from "../../tools/coverage-estimate.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineCoverageEstimateTool(govTool: GovTool): void {
  govTool(
    "coverage_estimate",
    {
      title: "カバレッジ推定",
      description: "変更されたソースファイルに対する想定テストカバレッジを推定します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        targetOrg: z.string().optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, targetOrg }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      targetOrg?: string;
    }) => {
      const result = estimateChangedCoverage({
        repoPath,
        baseBranch,
        workingBranch,
        targetOrg
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

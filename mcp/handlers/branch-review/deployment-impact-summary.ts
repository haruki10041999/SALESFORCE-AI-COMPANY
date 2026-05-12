import { z } from "zod";
import { summarizeDeploymentImpact } from "../../tools/deployment-impact-summary.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineDeploymentImpactSummaryTool(govTool: GovTool): void {
  govTool(
    "deployment_impact_summary",
    {
      title: "デプロイ影響サマリー",
      description: "変更がデプロイに与える影響を要約します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string()
      }
    },
    async ({ repoPath, baseBranch, workingBranch }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
    }) => {
      const result = summarizeDeploymentImpact({
        repoPath,
        baseBranch,
        workingBranch
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

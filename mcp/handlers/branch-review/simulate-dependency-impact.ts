import { z } from "zod";
import { buildMetadataDependencyGraph } from "../../tools/metadata-dependency-graph.js";
import { simulateDependencyImpact } from "../../core/dependency/impact-simulator.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineSimulateDependencyImpactTool(govTool: GovTool): void {
  govTool(
    "simulate_dependency_impact",
    {
      title: "依存影響シミュレーション",
      description: "メタデータ依存グラフを基に変更影響スコアと推奨アクションを算出します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxReferences: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxReferences }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxReferences?: number;
    }) => {
      const graph = buildMetadataDependencyGraph({
        repoPath,
        baseBranch,
        workingBranch,
        maxReferences
      });
      const result = simulateDependencyImpact(graph);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

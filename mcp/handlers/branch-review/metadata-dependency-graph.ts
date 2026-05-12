import { z } from "zod";
import { buildMetadataDependencyGraph } from "../../tools/metadata-dependency-graph.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineMetadataDependencyGraphTool(govTool: GovTool): void {
  govTool(
    "metadata_dependency_graph",
    {
      title: "メタデータ依存グラフ",
      description: "変更されたオブジェクトおよび項目のメタデータ依存関係を検出します。",
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
      const result = buildMetadataDependencyGraph({
        repoPath,
        baseBranch,
        workingBranch,
        maxReferences
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

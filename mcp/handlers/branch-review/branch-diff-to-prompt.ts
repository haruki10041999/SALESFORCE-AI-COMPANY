import { z } from "zod";
import { buildBranchDiffPrompt } from "../../tools/branch-diff-to-prompt.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineBranchDiffToPromptTool(govTool: GovTool): void {
  govTool(
    "branch_diff_to_prompt",
    {
      title: "ブランチ差分からプロンプト生成",
      description: "ブランチ差分からレビュー用プロンプトを生成します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        topic: z.string().optional(),
        turns: z.number().int().min(1).max(30).optional(),
        maxHighlights: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, topic, turns, maxHighlights }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      topic?: string;
      turns?: number;
      maxHighlights?: number;
    }) => {
      const result = buildBranchDiffPrompt({
        repoPath,
        baseBranch,
        workingBranch,
        topic,
        turns,
        maxHighlights
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                comparison: baseBranch + "..." + workingBranch,
                recommendedAgents: result.recommendedAgents,
                summary: result.summary,
                prompt: result.prompt
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

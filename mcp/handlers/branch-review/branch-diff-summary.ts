import { z } from "zod";
import { summarizeBranchDiff } from "../../tools/branch-diff-summary.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineBranchDiffSummaryTool(govTool: GovTool): void {
  govTool(
    "branch_diff_summary",
    {
      title: "ブランチ差分サマリー",
      description: "ブランチ差分の要約を生成します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxFiles: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxFiles }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxFiles?: number;
    }) => {
      const result = summarizeBranchDiff({
        repoPath,
        baseBranch,
        workingBranch,
        maxFiles: maxFiles ?? 20
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                comparison: baseBranch + "..." + workingBranch,
                filesChanged: result.filesChanged,
                added: result.added,
                modified: result.modified,
                deleted: result.deleted,
                renamed: result.renamed,
                copied: result.copied,
                fileTypeBreakdown: result.fileTypeBreakdown,
                summary: result.summary,
                fileChanges: result.fileChanges
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

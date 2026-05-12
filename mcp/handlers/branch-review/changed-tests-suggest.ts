import { z } from "zod";
import { suggestChangedTests } from "../../tools/changed-tests-suggest.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineChangedTestsSuggestTool(govTool: GovTool): void {
  govTool(
    "changed_tests_suggest",
    {
      title: "変更テスト提案",
      description: "変更内容に応じたテスト候補を提案します。",
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
      const result = suggestChangedTests({
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

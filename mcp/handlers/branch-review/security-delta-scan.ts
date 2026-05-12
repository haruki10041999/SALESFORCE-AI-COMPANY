import { z } from "zod";
import { scanSecurityDelta } from "../../tools/security-delta-scan.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineSecurityDeltaScanTool(govTool: GovTool): void {
  govTool(
    "security_delta_scan",
    {
      title: "セキュリティ差分スキャン",
      description: "差分に対するセキュリティ観点のスキャンを実行します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxFindings: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxFindings }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxFindings?: number;
    }) => {
      const result = scanSecurityDelta({
        repoPath,
        baseBranch,
        workingBranch,
        maxFindings
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

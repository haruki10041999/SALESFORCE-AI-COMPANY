import { z } from "zod";
import { scanSecurityRules } from "../../tools/security-rule-scan.js";
import type { GovTool } from "@mcp/tool-types.js";

export function defineScanSecurityRulesTool(govTool: GovTool): void {
  govTool(
    "scan_security_rules",
    {
      title: "拡張セキュリティスキャン",
      description: "ファイル本文に対してパターンベースのセキュリティルール (SOQL連結 / hardcoded credential / innerHTML / eval / weak crypto 他) を適用します。",
      inputSchema: {
        files: z.array(z.object({
          filePath: z.string().min(1),
          source: z.string()
        })).min(1).max(500)
      }
    },
    async ({ files }: { files: Array<{ filePath: string; source: string }> }) => {
      const result = scanSecurityRules(files);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

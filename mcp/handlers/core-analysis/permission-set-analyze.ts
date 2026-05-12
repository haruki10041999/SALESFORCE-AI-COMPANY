import { z } from "zod";
import { analyzePermissionSet } from "../../tools/permission-set-analyzer.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefinePermissionSetAnalyzeDeps extends RegisterGovToolDeps {}

export function definePermissionSetAnalyzeTool(deps: DefinePermissionSetAnalyzeDeps): void {
  const { govTool } = deps;

  govTool(
    "permission_set_analyze",
    {
      title: "権限セット解析",
      description: "Salesforce権限セットメタデータファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzePermissionSet(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

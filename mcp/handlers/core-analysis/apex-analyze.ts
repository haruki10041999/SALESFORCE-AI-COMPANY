import { z } from "zod";
import { analyzeApex } from "../../tools/apex-analyzer.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineApexAnalyzeDeps extends RegisterGovToolDeps {}

export function defineApexAnalyzeTool(deps: DefineApexAnalyzeDeps): void {
  const { govTool } = deps;

  govTool(
    "apex_analyze",
    {
      title: "Apex解析",
      description: "Apexファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeApex(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

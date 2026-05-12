import { z } from "zod";
import { analyzeFlow } from "../../tools/flow-analyzer.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineFlowAnalyzeDeps extends RegisterGovToolDeps {}

export function defineFlowAnalyzeTool(deps: DefineFlowAnalyzeDeps): void {
  const { govTool } = deps;

  govTool(
    "flow_analyze",
    {
      title: "Flow解析",
      description: "Salesforce Flowメタデータファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeFlow(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

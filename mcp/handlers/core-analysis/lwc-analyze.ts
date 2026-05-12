import { z } from "zod";
import { analyzeLwc } from "../../tools/lwc-analyzer.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineLwcAnalyzeDeps extends RegisterGovToolDeps {}

export function defineLwcAnalyzeTool(deps: DefineLwcAnalyzeDeps): void {
  const { govTool } = deps;

  govTool(
    "lwc_analyze",
    {
      title: "LWC解析",
      description: "LWC JavaScriptファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeLwc(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

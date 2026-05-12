import { z } from "zod";
import { starToRating } from "../../core/application/analytics/services/analytics-formatters.js";
import { executeRateToolExecution } from "../../core/application/analytics/services/analytics-feedback-tools.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRateToolExecutionDeps extends RegisterGovToolDeps {
  policySnapshotManager?: any;
}

export function defineRateToolExecutionTool(deps: DefineRateToolExecutionDeps): void {
  const { govTool, policySnapshotManager } = deps;

  govTool(
    "rate_tool_execution",
    {
      title: "ツール実行評価",
      description: "ツール実行結果に対する 1-5 の星評価を記録します。",
      inputSchema: {
        toolName: z.string().min(1),
        stars: z.number().int().min(1).max(5),
        sessionId: z.string().optional(),
        comment: z.string().optional(),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ toolName, stars, sessionId, comment, tags }: {
      toolName: string;
      stars: number;
      sessionId?: string;
      comment?: string;
      tags?: string[];
    }) => {
      const result = await executeRateToolExecution({
        toolName,
        stars,
        sessionId,
        comment,
        tags,
        starToRating,
        policySnapshotManager
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

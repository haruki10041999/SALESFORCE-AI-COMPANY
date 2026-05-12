import { z } from "zod";
import { executeAnalyzeChatTrendsTool } from "../../core/application/analytics/services/analytics-chat-trends-tool.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineAnalyzeChatTrendsDeps extends RegisterGovToolDeps {
  agentLog: any;
  loadChatHistories: any;
}

export function defineAnalyzeChatTrendsTool(deps: DefineAnalyzeChatTrendsDeps): void {
  const { govTool, agentLog, loadChatHistories } = deps;

  govTool(
    "analyze_chat_trends",
    {
      title: "チャット傾向分析",
      description: "チャットログの傾向を分析します。",
      inputSchema: {
        historyId: z.string().optional(),
        since: z.string().optional(),
        groupBy: z.enum(["agent", "topic"]).optional()
      }
    },
    async ({ historyId, since, groupBy }: { historyId?: string; since?: string; groupBy?: "agent" | "topic" }) => {
      const result = await executeAnalyzeChatTrendsTool({
        historyId,
        since,
        groupBy,
        agentLog,
        loadChatHistories
      });
      if (typeof result.errorText === "string") {
        return { content: [{ type: "text", text: result.errorText }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}

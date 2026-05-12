import { z } from "zod";
import { executeGetSessionFeedback } from "../../core/application/analytics/services/analytics-feedback-tools.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetSessionFeedbackDeps extends RegisterGovToolDeps {
  loadFeedbackForSession: any;
}

export function defineGetSessionFeedbackTool(deps: DefineGetSessionFeedbackDeps): void {
  const { govTool, loadFeedbackForSession } = deps;

  govTool(
    "get_session_feedback",
    {
      title: "セッションフィードバック",
      description: "特定のチャットセッションに対する全フィードバック記録を取得します。",
      inputSchema: {
        sessionId: z.string().min(1).describe("チャットセッション ID")
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      const result = await executeGetSessionFeedback({
        sessionId,
        loadFeedbackForSession
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

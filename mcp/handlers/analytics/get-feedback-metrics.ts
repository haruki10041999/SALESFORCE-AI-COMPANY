import { z } from "zod";
import { executeGetFeedbackMetrics } from "../../core/application/analytics/services/analytics-feedback-tools.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetFeedbackMetricsDeps extends RegisterGovToolDeps {
  computeFeedbackMetrics: any;
}

export function defineGetFeedbackMetricsTool(deps: DefineGetFeedbackMetricsDeps): void {
  const { govTool, computeFeedbackMetrics } = deps;

  govTool(
    "get_feedback_metrics",
    {
      title: "フィードバックメトリクス",
      description: "記録されたユーザーフィードバックの集計統計を取得します。",
      inputSchema: {
        sessionId: z.string().optional().describe("特定セッションに限定 (省略時は全体)")
      }
    },
    async ({ sessionId }: { sessionId?: string }) => {
      const result = await executeGetFeedbackMetrics({
        sessionId,
        computeFeedbackMetrics
      });
      return {
        content: [
          { type: "text", text: JSON.stringify(result.metrics, null, 2) },
          { type: "text", text: result.markdown }
        ]
      };
    }
  );
}

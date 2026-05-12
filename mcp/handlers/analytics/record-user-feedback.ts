import { z } from "zod";
import { executeRecordUserFeedback } from "../../core/application/analytics/services/analytics-feedback-tools.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRecordUserFeedbackDeps extends RegisterGovToolDeps {
  policySnapshotManager?: any;
}

export function defineRecordUserFeedbackTool(deps: DefineRecordUserFeedbackDeps): void {
  const { govTool, policySnapshotManager } = deps;

  govTool(
    "record_user_feedback",
    {
      title: "ユーザーフィードバック記録",
      description: "チャットセッションの品質に対するユーザーの評価 (👍/👎) を記録します。",
      inputSchema: {
        sessionId: z.string().min(1).describe("関連するチャットセッション ID"),
        rating: z.enum(["thumbs-up", "thumbs-down", "neutral"]).describe("評価: thumbs-up, thumbs-down, neutral"),
        agentName: z.string().optional().describe("対応エージェント名"),
        comment: z.string().optional().describe("ユーザーのコメント"),
        qualityScore: z.number().min(0).max(1).optional().describe("品質スコア (0-1)"),
        tags: z.array(z.string()).optional().describe("カテゴリタグ")
      }
    },
    async (input: {
      sessionId: string;
      rating: "thumbs-up" | "thumbs-down" | "neutral";
      agentName?: string;
      comment?: string;
      qualityScore?: number;
      tags?: string[];
    }) => {
      const result = await executeRecordUserFeedback({
        ...input,
        policySnapshotManager
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

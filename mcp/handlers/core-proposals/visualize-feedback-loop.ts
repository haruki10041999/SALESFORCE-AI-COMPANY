import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import { executeVisualizeFeedbackLoop } from "../../core/application/governance/services/resource-feedback-loop-visualization.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineVisualizeFeedbackLoopDeps extends RegisterGovToolDeps {
  // No additional deps beyond govTool
}

export function defineVisualizeFeedbackLoopTool(deps: DefineVisualizeFeedbackLoopDeps): void {
  const { govTool } = deps;
  const outputsDir = resolve(getOutputsDir());
  const proposalFeedbackLog = join(outputsDir, "tool-proposals", "proposal-feedback.jsonl");

  govTool(
    "visualize_feedback_loop",
    {
      title: "Feedback Loop 可視化",
      description: "proposal_feedback_learn で蓄積したフィードバックの推移・トピック別ヒートマップ・トレンドを集計します。",
      inputSchema: z.object({
        periodDays: z.number().int().min(1).max(365).optional(),
        trendWindowDays: z.number().int().min(1).max(180).optional(),
        minSamples: z.number().int().min(1).max(100).optional(),
        topResources: z.number().int().min(1).max(100).optional(),
        topTopics: z.number().int().min(1).max(200).optional()
      })
    },
    async ({
      periodDays,
      trendWindowDays,
      minSamples,
      topResources,
      topTopics
    }: {
      periodDays?: number;
      trendWindowDays?: number;
      minSamples?: number;
      topResources?: number;
      topTopics?: number;
    }) => {
      const payload = await executeVisualizeFeedbackLoop({
        proposalFeedbackLog,
        input: {
          periodDays,
          trendWindowDays,
          minSamples,
          topResources,
          topTopics
        }
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(payload.result, null, 2) },
          { type: "text", text: payload.markdown }
        ]
      };
    }
  );
}

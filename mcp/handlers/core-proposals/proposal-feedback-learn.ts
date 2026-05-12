import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import {
  executeProposalFeedbackLearn,
  type ProposalFeedbackDecision,
  type ProposalFeedbackEntryInput
} from "../../core/application/governance/services/resource-proposal-feedback-learn.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineProposalFeedbackLearnDeps extends RegisterGovToolDeps {
  // No additional deps beyond govTool
}

export function defineProposalFeedbackLearnTool(deps: DefineProposalFeedbackLearnDeps): void {
  const { govTool } = deps;
  const outputsDir = resolve(getOutputsDir());
  const proposalFeedbackLog = join(outputsDir, "tool-proposals", "proposal-feedback.jsonl");
  const proposalFeedbackModel = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");
  const querySkillFeedbackLog = join(outputsDir, "tool-proposals", "query-skill-feedback.jsonl");
  const querySkillModel = join(outputsDir, "tool-proposals", "query-skill-model.json");

  govTool(
    "proposal_feedback_learn",
    {
      title: "提案ログ学習フィードバック",
      description: "提案の採用/不採用ログを学習し、次回推薦スコア補正モデルを更新します。",
      inputSchema: z.object({
        feedback: z.array(z.object({
          resourceType: z.enum(["skills", "tools", "presets"]),
          name: z.string(),
          decision: z.enum([
            "accepted",
            "rejected",
            "reject_inaccurate",
            "reject_unnecessary",
            "reject_duplicate"
          ]),
          topic: z.string().optional(),
          note: z.string().optional(),
          recordedAt: z.string().optional()
        })).min(1).max(200),
        minSamples: z.number().int().min(1).max(50).optional()
      })
    },
    async ({
      feedback,
      minSamples
    }: {
      feedback: ProposalFeedbackEntryInput[];
      minSamples?: number;
    }) => {
      const payload = await executeProposalFeedbackLearn({
        feedback: feedback.map((entry) => ({
          ...entry,
          decision: entry.decision as ProposalFeedbackDecision
        })),
        minSamples,
        proposalFeedbackLog,
        proposalFeedbackModel,
        querySkillFeedbackLog,
        querySkillModel
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );
}

import { z } from "zod";
import { executeLinUcbRankArms } from "../../core/application/analytics/services/analytics-linucb.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineLinUcbRankArmsDeps extends RegisterGovToolDeps {}

export function defineLinUcbRankArmsTool(deps: DefineLinUcbRankArmsDeps): void {
  const { govTool } = deps;

  govTool(
    "linucb_rank_arms",
    {
      title: "LinUCB 候補推奨",
      description: "特徴量と報酬履歴から LinUCB で候補をランキングします。",
      inputSchema: {
        arms: z.array(
          z.object({
            name: z.string().min(1),
            features: z.array(z.number()).min(1)
          })
        ).min(1),
        feedbacks: z.array(
          z.object({
            name: z.string().min(1),
            features: z.array(z.number()).min(1),
            reward: z.number()
          })
        ).optional(),
        alpha: z.number().min(0).max(10).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        featureNames: z.array(z.string().min(1)).optional(),
        importanceLimit: z.number().int().min(1).max(200).optional(),
        snapshot: z.any().optional()
      }
    },
    async (input: any) => {
      const result = await executeLinUcbRankArms(input as Parameters<typeof executeLinUcbRankArms>[0]);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

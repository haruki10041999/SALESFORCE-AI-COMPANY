import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeRecommendFirstSteps
} from "../../core/application/resource/services/resource-search-operations.js";

export interface DefineRecommendFirstStepsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  scoreByQuery: (query: string, ...targets: string[]) => number;
}

export function defineRecommendFirstStepsTool(deps: DefineRecommendFirstStepsDeps): void {
  const { govTool, loadGovernanceState, listMdFiles, scoreByQuery } = deps;

  const outputsDir = resolve(getOutputsDir());
  const proposalFeedbackModelFile = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");
  const querySkillModelFile = join(outputsDir, "tool-proposals", "query-skill-model.json");

  govTool(
    "recommend_first_steps",
    {
      title: "最初の一歩提案",
      description: "目的に合わせて最初に実施すべき3ステップを提案します。",
      inputSchema: z.object({
        goal: z.string(),
        limitPerType: z.number().int().min(1).max(5).optional()
      })
    },
    async ({ goal, limitPerType }: { goal: string; limitPerType?: number }) => {
      const payload = await executeRecommendFirstSteps({
        goal,
        limitPerType,
        loadGovernanceState,
        listMdFiles,
        scoreByQuery,
        proposalFeedbackModelFile,
        querySkillModelFile
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

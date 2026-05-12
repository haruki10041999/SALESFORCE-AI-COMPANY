import { z } from "zod";
import { scoreAgentSynergy } from "../../tools/agent-synergy-score.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineScoreAgentSynergyDeps extends RegisterGovToolDeps {
  loadChatHistories: any;
}

export function defineScoreAgentSynergyTool(deps: DefineScoreAgentSynergyDeps): void {
  const { govTool, loadChatHistories } = deps;

  govTool(
    "score_agent_synergy",
    {
      title: "エージェント協調スコア",
      description: "チャット履歴からエージェントペアの協調 (lift) とスコアを算出します。",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        minCooccurrence: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ limit, minCooccurrence }: { limit?: number; minCooccurrence?: number }) => {
      const sessions = await loadChatHistories();
      const result = scoreAgentSynergy(sessions, { limit, minCooccurrence });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

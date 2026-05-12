import { z } from "zod";
import { executeUpdateAgentReputation } from "../../core/application/analytics/services/analytics-agent-reputation.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineUpdateAgentReputationDeps extends RegisterGovToolDeps {
  agentReputationFile: string;
}

export function defineUpdateAgentReputationTool(deps: DefineUpdateAgentReputationDeps): void {
  const { govTool, agentReputationFile } = deps;

  govTool(
    "update_agent_reputation",
    {
      title: "Agent Reputation 更新",
      description: "agent の reputation を global/topic/org/user 単位で更新します。",
      inputSchema: {
        agentName: z.string().min(1),
        delta: z.number().min(-1).max(1),
        reason: z.string().optional(),
        topic: z.string().optional(),
        org: z.string().optional(),
        user: z.string().optional(),
        updateGlobal: z.boolean().optional()
      }
    },
    async ({ agentName, delta, reason, topic, org, user, updateGlobal }: {
      agentName: string;
      delta: number;
      reason?: string;
      topic?: string;
      org?: string;
      user?: string;
      updateGlobal?: boolean;
    }) => {
      const result = await executeUpdateAgentReputation({
        agentName,
        delta,
        reason,
        topic,
        org,
        user,
        updateGlobal,
        agentReputationFile
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

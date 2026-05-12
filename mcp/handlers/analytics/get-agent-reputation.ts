import { z } from "zod";
import { executeGetAgentReputation } from "../../core/application/analytics/services/analytics-agent-reputation.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetAgentReputationDeps extends RegisterGovToolDeps {
  agentReputationFile: string;
}

export function defineGetAgentReputationTool(deps: DefineGetAgentReputationDeps): void {
  const { govTool, agentReputationFile } = deps;

  govTool(
    "get_agent_reputation",
    {
      title: "Agent Reputation 取得",
      description: "agent の global/topic/org/user reputation と effective score を返します。",
      inputSchema: {
        agentName: z.string().min(1),
        topic: z.string().optional(),
        org: z.string().optional(),
        user: z.string().optional()
      }
    },
    async ({ agentName, topic, org, user }: {
      agentName: string;
      topic?: string;
      org?: string;
      user?: string;
    }) => {
      const result = await executeGetAgentReputation({
        agentName,
        topic,
        org,
        user,
        agentReputationFile
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

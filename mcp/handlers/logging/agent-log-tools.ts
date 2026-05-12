import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

export interface DefineAgentLogToolsDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
}

export function defineAgentLogTools(deps: DefineAgentLogToolsDeps): void {
  const { govTool, agentLog } = deps;

  govTool(
    "record_agent_message",
    {
      title: "エージェントメッセージ記録",
      description: "エージェントのメッセージを記録します。",
      inputSchema: {
        agent: z.string(),
        message: z.string(),
        topic: z.string().optional()
      }
    },
    async ({ agent, message, topic }: { agent: string; message: string; topic?: string }) => {
      const entry: AgentMessage = {
        agent,
        message,
        timestamp: new Date().toISOString(),
        topic
      };
      agentLog.push(entry);
      return {
        content: [{ type: "text", text: "Recorded: [" + entry.timestamp + "] " + agent }]
      };
    }
  );

  govTool(
    "get_agent_log",
    {
      title: "エージェントログ取得",
      description: "エージェントログを取得します。",
      inputSchema: {
        agent: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ agent, limit }: { agent?: string; limit?: number }) => {
      let entries = agentLog;
      if (agent) {
        entries = entries.filter((e) => e.agent === agent);
      }
      if (limit) {
        entries = entries.slice(-limit);
      }
      const summary = {
        total: agentLog.length,
        filtered: entries.length,
        agents: [...new Set(agentLog.map((e) => e.agent))],
        entries
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }
  );
}

import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

export interface DefineParseAndRecordChatToolDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
  saveChatHistory?: (topic: string) => Promise<string>;
  emitSystemEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function defineParseAndRecordChatTool(deps: DefineParseAndRecordChatToolDeps): void {
  const { govTool, agentLog, saveChatHistory, emitSystemEvent } = deps;

  govTool(
    "parse_and_record_chat",
    {
      title: "チャット解析と記録",
      description: "チャットテキストを解析して記録します。",
      inputSchema: {
        chatText: z.string(),
        topic: z.string().optional()
      }
    },
    async ({ chatText, topic }: { chatText: string; topic?: string }) => {
      const normalized = chatText.replace(/\r\n/g, "\n");
      const pattern = /\*\*([^*\n]+)\*\*:\s([\s\S]*?)(?=\n\*\*[^*\n]+\*\*:\s|$)/g;

      const parsed: AgentMessage[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(normalized)) !== null) {
        const agent = match[1].trim();
        const message = match[2].trim();
        if (!agent || !message) {
          continue;
        }
        parsed.push({
          agent,
          message,
          timestamp: new Date().toISOString(),
          topic
        });
      }

      if (parsed.length === 0) {
        return {
          content: [{ type: "text", text: "No agent messages were parsed. Format example: **Agent Name**: message" }]
        };
      }

      agentLog.push(...parsed);
      const uniqueAgents = [...new Set(parsed.map((p) => p.agent))];
      let autoSavedHistoryId: string | null = null;

      if (topic && saveChatHistory) {
        autoSavedHistoryId = await saveChatHistory(topic);
        if (emitSystemEvent) {
          await emitSystemEvent("history_saved", {
            historyId: autoSavedHistoryId,
            topic,
            messageCount: parsed.length,
            path: "outputs/history/" + autoSavedHistoryId.slice(0, 10) + "/" + autoSavedHistoryId + ".json",
            source: "parse_and_record_chat:auto-save"
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recorded: parsed.length,
                topic: topic ?? null,
                agents: uniqueAgents,
                totalLogCount: agentLog.length,
                autoSavedHistoryId
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

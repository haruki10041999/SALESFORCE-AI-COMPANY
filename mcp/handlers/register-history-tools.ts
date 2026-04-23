import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

interface RegisterHistoryToolsDeps {
  govTool: GovTool;
  agentLog: AgentMessage[];
  saveChatHistory: (topic: string) => Promise<string>;
  loadChatHistories: () => Promise<ChatSession[]>;
  restoreChatHistory: (id: string) => Promise<ChatSession | null>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function registerHistoryTools(deps: RegisterHistoryToolsDeps): void {
  const {
    govTool,
    agentLog,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    emitSystemEvent
  } = deps;

  govTool(
    "save_chat_history",
    {
      title: "Save Chat History",
      description: "Auto-generated description.",
      inputSchema: {
        topic: z.string()
      }
    },
    async ({ topic }: { topic: string }) => {
      const id = await saveChatHistory(topic);
      const messageCount = agentLog.filter((e) => e.topic === topic || !e.topic).length;
      await emitSystemEvent("history_saved", {
        historyId: id,
        topic,
        messageCount,
        path: "outputs/history/" + id + ".json"
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { saved: true, id, path: "outputs/history/" + id + ".json" },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "load_chat_history",
    {
      title: "Load Chat History",
      description: "Auto-generated description.",
      inputSchema: {}
    },
    async () => {
      const sessions = await loadChatHistories();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              sessions.map((s) => ({
                id: s.id,
                timestamp: s.timestamp,
                topic: s.topic,
                agents: s.agents,
                messageCount: s.entries.length
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "restore_chat_history",
    {
      title: "Restore Chat History",
      description: "Auto-generated description.",
      inputSchema: {
        id: z.string()
      }
    },
    async ({ id }: { id: string }) => {
      const session = await restoreChatHistory(id);
      if (!session) {
        return {
          content: [{ type: "text", text: "History not found: " + id }]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                restored: true,
                topic: session.topic,
                agents: session.agents,
                messages: session.entries.length
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



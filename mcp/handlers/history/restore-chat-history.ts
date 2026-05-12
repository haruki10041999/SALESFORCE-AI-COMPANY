import { z } from "zod";
import type { RegisterHistoryToolsDeps } from "../register-history-tools.js";

export function defineRestoreChatHistoryTool(deps: RegisterHistoryToolsDeps): void {
  const { govTool, restoreChatHistory } = deps;

  govTool(
    "restore_chat_history",
    {
      title: "チャット履歴復元",
      description: "保存済みチャット履歴を復元します。",
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

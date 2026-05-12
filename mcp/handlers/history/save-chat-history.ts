import { z } from "zod";
import type { RegisterHistoryToolsDeps } from "../register-history-tools.js";

export function defineSaveChatHistoryTool(deps: RegisterHistoryToolsDeps): void {
  const { govTool, agentLog, saveChatHistory, emitSystemEvent } = deps;

  govTool(
    "save_chat_history",
    {
      title: "チャット履歴保存",
      description: "現在のチャット履歴を保存します。",
      inputSchema: {
        topic: z.string()
      }
    },
    async ({ topic }: { topic: string }) => {
      const id = await saveChatHistory(topic);
      const day = id.slice(0, 10);
      const relativePath = "outputs/history/" + day + "/" + id + ".json";
      const messageCount = agentLog.filter((e) => e.topic === topic || !e.topic).length;
      await emitSystemEvent("history_saved", {
        historyId: id,
        topic,
        messageCount,
        path: relativePath
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { saved: true, id, path: relativePath },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

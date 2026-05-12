import type { RegisterHistoryToolsDeps } from "../register-history-tools.js";

export function defineLoadChatHistoryTool(deps: RegisterHistoryToolsDeps): void {
  const { govTool, loadChatHistories } = deps;

  govTool(
    "load_chat_history",
    {
      title: "チャット履歴読込",
      description: "保存済みチャット履歴を読み込みます。",
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
}

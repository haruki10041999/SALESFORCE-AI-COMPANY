import type { RegisterGovToolDeps } from "../types.js";

export interface DefineChatToolDeps extends RegisterGovToolDeps {
  chatInputSchema: Record<string, unknown>;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

export function defineChatTool(deps: DefineChatToolDeps): void {
  const { govTool, chatInputSchema, runChatTool } = deps;

  govTool(
    "chat",
    {
      title: "チャット（デフォルト）",
      description: "既定設定でチャットを実行します。",
      inputSchema: chatInputSchema
    },
    runChatTool
  );
}

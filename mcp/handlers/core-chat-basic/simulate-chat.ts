import type { RegisterGovToolDeps } from "../types.js";

export interface DefineSimulateChatToolDeps extends RegisterGovToolDeps {
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

export function defineSimulateChatTool(deps: DefineSimulateChatToolDeps): void {
  const { govTool, chatInputSchema, runChatTool } = deps;

  govTool(
    "simulate_chat",
    {
      title: "マルチエージェントチャット実行（互換エイリアス）",
      description: "互換エイリアスとしてマルチエージェントチャットを実行します。",
      inputSchema: chatInputSchema
    },
    runChatTool
  );
}

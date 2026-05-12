import type { RegisterGovToolDeps } from "./types.js";
import { defineSaveChatHistoryTool } from "./history/save-chat-history.js";
import { defineLoadChatHistoryTool } from "./history/load-chat-history.js";
import { defineRestoreChatHistoryTool } from "./history/restore-chat-history.js";

export interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

export interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

export interface RegisterHistoryToolsDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
  saveChatHistory: (topic: string) => Promise<string>;
  loadChatHistories: () => Promise<ChatSession[]>;
  restoreChatHistory: (id: string) => Promise<ChatSession | null>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function registerHistoryTools(deps: RegisterHistoryToolsDeps): void {
  defineSaveChatHistoryTool(deps);
  defineLoadChatHistoryTool(deps);
  defineRestoreChatHistoryTool(deps);
}



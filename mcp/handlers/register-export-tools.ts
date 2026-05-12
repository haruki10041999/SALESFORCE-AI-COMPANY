import type { RegisterGovToolDeps } from "./types.js";
import { defineExportToMarkdownTool } from "./lightweight/export-to-markdown.js";

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

export interface RegisterExportToolsDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
  loadChatHistories: () => Promise<ChatSession[]>;
  ensureDir: (dir: string) => Promise<void>;
}

export function registerExportTools(deps: RegisterExportToolsDeps): void {
  defineExportToMarkdownTool(deps);
}



export interface AgentChatRequest {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
}

export interface AgentChatResponse {
  content: Array<{ type: string; text: string }>;
}

export interface AgentChatService {
  chat(input: AgentChatRequest): Promise<AgentChatResponse>;
}

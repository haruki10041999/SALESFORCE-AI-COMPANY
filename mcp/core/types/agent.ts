/**
 * Agent conversation message
 */
export interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

/**
 * Chat session with complete history
 */
export interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

import type { AgentMessage, ChatSession } from "./agent.js";
import type { TriggerRule } from "./trigger-rule.js";

/**
 * Orchestration session with trigger-based workflow
 */
export interface OrchestrationSession {
  id: string;
  topic: string;
  agents: string[];
  persona?: string;
  skills: string[];
  filePaths: string[];
  turns: number;
  appendInstruction?: string;
  triggerRules: TriggerRule[];
  queue: string[];
  history: AgentMessage[];
  firedRules: string[];
  agentTrust: Record<string, {
    accepted: number;
    rejected: number;
    feedbackSignal: number;
  }>;
}

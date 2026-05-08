/**
 * Snapshot of a recorded session for replay and AB testing
 */
export interface SessionSnapshot {
  id: string;
  tenantId: string;
  sessionType: "agent-session" | "flow-session";
  systemPrompt: string;
  turns?: Array<{
    turn: number;
    input: string;
    output: string;
    agentsInvolved: string[];
    skillsUsed: string[];
    toolsUsed: string[];
    duration: number;
  }>;
  toolExecutions?: Array<{
    tool: string;
    args?: Record<string, unknown>;
    status: "success" | "failure";
    duration?: number;
  }>;
  feedback?: {
    score?: number;
    scoreAdjustment?: number;
    comment?: string;
  };
  metrics?: {
    tokenUsage?: {
      total: number;
      input?: number;
      output?: number;
    };
  };
  agentOrder?: string[];
  modelUsed?: string;
  createdAt: Date;
  status: string;
}

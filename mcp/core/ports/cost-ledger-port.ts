export interface CostLedgerPort {
  record(input: {
    toolName: string;
    costUsd: number;
    inputTokens?: number;
    outputTokens?: number;
    actorId?: string;
    tenantId?: string;
    sessionId?: string;
    traceId?: string;
    model?: string;
    status?: "success" | "error" | "blocked";
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

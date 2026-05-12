export interface CostLedgerPort {
  record(input: {
    toolName: string;
    costUsd: number;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

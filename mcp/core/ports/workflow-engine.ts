export interface WorkflowEngine {
  enqueue(input: {
    sessionId: string;
    topic: string;
    agents: string[];
    turns?: number;
  }): Promise<void>;
}

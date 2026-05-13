export type WorkflowStepStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowRuntimeMode = "in-process" | "temporal";

export interface WorkflowStepRecord {
  sessionId: string;
  stepIndex: number;
  agent: string;
  status: WorkflowStepStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  inputHash?: string;
  outputHash?: string;
  errorJson?: Record<string, unknown> | null;
  checkpointJson?: Record<string, unknown> | null;
}

export interface WorkflowRunHandle {
  workflowId: string;
  runId?: string;
  sessionId: string;
  mode: WorkflowRuntimeMode;
}

export interface WorkflowQueryResult {
  sessionId: string;
  mode: WorkflowRuntimeMode;
  steps: WorkflowStepRecord[];
}

export interface WorkflowEngine {
  start(input: {
    sessionId: string;
    topic: string;
    agents: string[];
    turns?: number;
  }): Promise<WorkflowRunHandle>;
  query(sessionId: string): Promise<WorkflowQueryResult>;
  replay(sessionId: string): Promise<WorkflowStepRecord[]>;
  enqueue(input: {
    sessionId: string;
    topic: string;
    agents: string[];
    turns?: number;
  }): Promise<void>;
  signal(input: {
    sessionId: string;
    agent: string;
    payload?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<WorkflowStepRecord>;
  retry(input: {
    sessionId: string;
    agent: string;
    reason?: string;
    payload?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<WorkflowStepRecord | null>;
  listSteps(sessionId: string): Promise<WorkflowStepRecord[]>;
  markDequeued(sessionId: string, agent: string): Promise<WorkflowStepRecord | null>;
  completeStep(input: {
    sessionId: string;
    agent: string;
    output?: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<WorkflowStepRecord | null>;
  failStep(input: {
    sessionId: string;
    agent: string;
    error: unknown;
    checkpoint?: Record<string, unknown>;
  }): Promise<WorkflowStepRecord | null>;
}

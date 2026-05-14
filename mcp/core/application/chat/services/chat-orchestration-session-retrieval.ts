import type { OrchestrationSession } from "../../../types/index.js";
import type { SessionStore } from "../../../persistence/session-store.js";
import type { OrchestrationQueueStore } from "../../../orchestration/orchestration-queue-store.js";
import type { WorkflowEngine, WorkflowStepRecord } from "../../../ports/workflow-engine.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProjectedTopic(step: WorkflowStepRecord | undefined, sessionId: string): string {
  const checkpoint = step?.checkpointJson;
  if (!isRecord(checkpoint)) {
    return `workflow:${sessionId}`;
  }
  const topic = checkpoint.topic;
  return typeof topic === "string" && topic.trim().length > 0 ? topic : `workflow:${sessionId}`;
}

function normalizeProjectedTurns(step: WorkflowStepRecord | undefined): number {
  const checkpoint = step?.checkpointJson;
  if (!isRecord(checkpoint)) {
    return 6;
  }
  const turns = checkpoint.turns;
  return typeof turns === "number" && Number.isFinite(turns) && turns > 0 ? turns : 6;
}

function projectSessionFromWorkflowState(args: {
  sessionId: string;
  steps: WorkflowStepRecord[];
}): OrchestrationSession | undefined {
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    return undefined;
  }

  const sortedSteps = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const agents = [...new Set(sortedSteps.map((step) => step.agent).filter((agent) => agent.trim().length > 0))];
  if (agents.length === 0) {
    return undefined;
  }

  const queue = sortedSteps
    .filter((step) => step.status === "queued" || step.status === "running")
    .map((step) => step.agent)
    .filter((agent) => agent.trim().length > 0);

  const firstStep = sortedSteps[0];
  return {
    id: args.sessionId,
    topic: normalizeProjectedTopic(firstStep, args.sessionId),
    agents,
    skills: [],
    filePaths: [],
    turns: normalizeProjectedTurns(firstStep),
    triggerRules: [],
    queue,
    history: [],
    firedRules: [],
    agentTrust: {}
  };
}

export async function executeGetSessionOrRestore(args: {
  sessionId: string;
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  liveSessionCache: Map<string, OrchestrationSession | undefined>;
  workflowEngine: WorkflowEngine;
}): Promise<OrchestrationSession | undefined> {
  const { sessionId, sessionStore, orchestrationQueueStore, liveSessionCache, workflowEngine } = args;

  const cached = liveSessionCache.get(sessionId);
  if (cached) {
    return cached;
  }
  const fromStore = await sessionStore.getById(sessionId);
  if (fromStore) {
    await orchestrationQueueStore.replace(sessionId, fromStore.queue);
    liveSessionCache.set(sessionId, fromStore);
    return fromStore;
  }

  // Temporal-first fallback: reconstruct a minimal session projection from workflow state.
  try {
    const workflowState = await workflowEngine.query(sessionId);
    const projected = projectSessionFromWorkflowState({
      sessionId,
      steps: workflowState.steps
    });
    if (!projected) {
      return undefined;
    }

    await orchestrationQueueStore.replace(sessionId, projected.queue);
    liveSessionCache.set(sessionId, projected);

    // Best-effort projection backfill so subsequent reads can come from session-store.
    await sessionStore.upsert(projected, -1);
    return projected;
  } catch {
    return undefined;
  }
}

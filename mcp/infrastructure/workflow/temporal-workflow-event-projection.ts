import type { StoredEvent } from "../../core/ports/event-store.js";
import type { WorkflowStepRecord } from "../../core/ports/workflow-engine.js";

export interface WorkflowEventProjectionSummary {
  source: "workflow-history";
  streamId: string;
  eventCount: number;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  latestEventType?: string;
  latestOccurredAt?: string;
}

function normalizeOccurredAt(step: WorkflowStepRecord): string {
  if (step.finishedAt && step.finishedAt.trim().length > 0) {
    return step.finishedAt;
  }
  if (step.startedAt && step.startedAt.trim().length > 0) {
    return step.startedAt;
  }
  return new Date().toISOString();
}

function toEventType(status: WorkflowStepRecord["status"]): string {
  return `workflow.step.${status}`;
}

export function projectWorkflowStepsToStoredEvents(args: {
  sessionId: string;
  steps: WorkflowStepRecord[];
}): StoredEvent[] {
  const streamId = `workflow:${args.sessionId}`;
  const sorted = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  return sorted.map((step, index) => ({
    id: index + 1,
    globalSeq: index + 1,
    streamId,
    eventType: toEventType(step.status),
    version: index,
    payload: {
      sessionId: step.sessionId,
      stepIndex: step.stepIndex,
      agent: step.agent,
      status: step.status,
      attempt: step.attempt,
      startedAt: step.startedAt ?? null,
      finishedAt: step.finishedAt ?? null,
      inputHash: step.inputHash ?? null,
      outputHash: step.outputHash ?? null,
      errorJson: step.errorJson ?? null,
      checkpointJson: step.checkpointJson ?? null
    },
    occurredAt: normalizeOccurredAt(step),
    status: "active"
  }));
}

export function summarizeWorkflowEventProjection(args: {
  sessionId: string;
  events: StoredEvent[];
}): WorkflowEventProjectionSummary {
  const counts = {
    queuedCount: 0,
    runningCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0
  };

  for (const event of args.events) {
    if (event.eventType === "workflow.step.queued") {
      counts.queuedCount += 1;
    } else if (event.eventType === "workflow.step.running") {
      counts.runningCount += 1;
    } else if (event.eventType === "workflow.step.completed") {
      counts.completedCount += 1;
    } else if (event.eventType === "workflow.step.failed") {
      counts.failedCount += 1;
    } else if (event.eventType === "workflow.step.cancelled") {
      counts.cancelledCount += 1;
    }
  }

  const latest = args.events.length > 0 ? args.events[args.events.length - 1] : undefined;
  return {
    source: "workflow-history",
    streamId: `workflow:${args.sessionId}`,
    eventCount: args.events.length,
    queuedCount: counts.queuedCount,
    runningCount: counts.runningCount,
    completedCount: counts.completedCount,
    failedCount: counts.failedCount,
    cancelledCount: counts.cancelledCount,
    latestEventType: latest?.eventType,
    latestOccurredAt: latest?.occurredAt
  };
}
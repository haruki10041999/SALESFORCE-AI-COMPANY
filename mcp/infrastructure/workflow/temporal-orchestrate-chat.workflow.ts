import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";

import type { WorkflowQueryResult, WorkflowStepRecord } from "../../core/ports/workflow-engine.js";
import type { TemporalWorkflowActivities } from "./temporal-workflow-activities.js";

export interface TemporalOrchestrateChatInput {
  sessionId: string;
  topic: string;
  agents: string[];
  turns?: number;
  activityTimeoutSeconds?: number;
  activityRetryMaximumAttempts?: number;
  activityRetryInitialIntervalMs?: number;
  activityRetryBackoffCoefficient?: number;
}

export interface TemporalWorkflowAgentInput {
  sessionId: string;
  agent: string;
}

export interface TemporalWorkflowSignalInput extends TemporalWorkflowAgentInput {
  payload?: unknown;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalWorkflowRetryInput extends TemporalWorkflowSignalInput {
  reason?: string;
}

export interface TemporalWorkflowCompleteInput extends TemporalWorkflowAgentInput {
  output?: unknown;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalWorkflowFailInput extends TemporalWorkflowAgentInput {
  error?: string;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalOrchestrateChatResult extends WorkflowQueryResult {
  workflowId: string;
  runCompleted: boolean;
}

export const temporalWorkflowStateQuery = defineQuery<WorkflowQueryResult>("getWorkflowState");
export const temporalWorkflowReplayQuery = defineQuery<WorkflowStepRecord[]>("getWorkflowReplay");
export const temporalWorkflowEnqueueSignal = defineSignal<[TemporalOrchestrateChatInput]>("enqueueWorkflowSteps");
export const temporalWorkflowSignalStep = defineSignal<[TemporalWorkflowSignalInput]>("appendSignalStep");
export const temporalWorkflowRetryStep = defineSignal<[TemporalWorkflowRetryInput]>("retryWorkflowStep");
export const temporalWorkflowMarkDequeued = defineSignal<[TemporalWorkflowAgentInput]>("markDequeuedStep");
export const temporalWorkflowCompleteStep = defineSignal<[TemporalWorkflowCompleteInput]>("completeWorkflowStep");
export const temporalWorkflowFailStep = defineSignal<[TemporalWorkflowFailInput]>("failWorkflowStep");

function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

function buildQueuedSteps(input: TemporalOrchestrateChatInput, startIndex = 0): WorkflowStepRecord[] {
  return input.agents.map((agent, offset) => ({
    sessionId: input.sessionId,
    stepIndex: startIndex + offset,
    agent,
    status: "queued",
    attempt: 0,
    checkpointJson: {
      topic: input.topic,
      turns: input.turns ?? null
    }
  }));
}

function isTerminalStatus(status: WorkflowStepRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export async function orchestrateChatWorkflow(
  input: TemporalOrchestrateChatInput
): Promise<TemporalOrchestrateChatResult> {
  const activities = proxyActivities<TemporalWorkflowActivities>({
    startToCloseTimeout: (input.activityTimeoutSeconds ?? 60) * 1000,
    retry: {
      maximumAttempts: input.activityRetryMaximumAttempts ?? 3,
      initialInterval: input.activityRetryInitialIntervalMs ?? 1000,
      backoffCoefficient: input.activityRetryBackoffCoefficient ?? 2
    }
  });

  const state: TemporalOrchestrateChatResult = {
    workflowId: input.sessionId,
    sessionId: input.sessionId,
    mode: "temporal",
    steps: buildQueuedSteps(input),
    runCompleted: false
  };

  await activities.enqueueWorkflow(input);

  setHandler(temporalWorkflowStateQuery, () => ({
    sessionId: state.sessionId,
    mode: state.mode,
    steps: state.steps.map((step) => ({ ...step }))
  }));

  setHandler(temporalWorkflowReplayQuery, () => state.steps.map((step) => ({ ...step })));

  setHandler(temporalWorkflowEnqueueSignal, async (nextInput) => {
    const nextIndex = state.steps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
    state.steps.push(...buildQueuedSteps(nextInput, nextIndex));
    await activities.enqueueWorkflow(nextInput);
  });

  setHandler(temporalWorkflowSignalStep, async (signalInput) => {
    const nextIndex = state.steps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
    state.steps.push({
      sessionId: signalInput.sessionId,
      stepIndex: nextIndex,
      agent: signalInput.agent,
      status: "queued",
      attempt: 0,
      checkpointJson: signalInput.checkpoint ?? null
    });
    await activities.signalWorkflow(signalInput);
  });

  setHandler(temporalWorkflowRetryStep, async (retryInput) => {
    const nextIndex = state.steps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
    const latestFailed = [...state.steps]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === retryInput.agent && step.status === "failed");
    state.steps.push({
      sessionId: retryInput.sessionId,
      stepIndex: nextIndex,
      agent: retryInput.agent,
      status: "queued",
      attempt: 0,
      checkpointJson: {
        ...(retryInput.checkpoint ?? {}),
        retryOf: latestFailed?.stepIndex ?? null,
        reason: retryInput.reason ?? null
      }
    });
    await activities.retryWorkflow(retryInput);
  });

  setHandler(temporalWorkflowMarkDequeued, async ({ sessionId, agent }) => {
    const queued = state.steps.find((step) => step.agent === agent && step.status === "queued");
    if (!queued) {
      return;
    }
    queued.status = "running";
    queued.attempt += 1;
    queued.startedAt = nowIso();
    await activities.markDequeuedStep({ sessionId, agent });
  });

  setHandler(temporalWorkflowCompleteStep, async ({ sessionId, agent, output, checkpoint }) => {
    const running = [...state.steps]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === agent && step.status === "running");
    if (!running) {
      return;
    }
    running.status = "completed";
    running.finishedAt = nowIso();
    running.checkpointJson = checkpoint ?? running.checkpointJson ?? null;
    await activities.completeWorkflowStep({ sessionId, agent, output, checkpoint });
  });

  setHandler(temporalWorkflowFailStep, async ({ sessionId, agent, error, checkpoint }) => {
    const running = [...state.steps]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === agent && step.status === "running");
    if (!running) {
      return;
    }
    running.status = "failed";
    running.finishedAt = nowIso();
    running.errorJson = error ? { message: error } : { message: "unknown failure" };
    running.checkpointJson = checkpoint ?? running.checkpointJson ?? null;
    await activities.failWorkflowStep({ sessionId, agent, error, checkpoint });
  });

  await condition(() => state.steps.length > 0 && state.steps.every((step) => isTerminalStatus(step.status)));
  state.runCompleted = true;

  return {
    workflowId: state.workflowId,
    sessionId: state.sessionId,
    mode: state.mode,
    steps: state.steps.map((step) => ({ ...step })),
    runCompleted: state.runCompleted
  };
}

import type { WorkflowStepRecord } from "../../core/ports/workflow-engine.js";
import type { OrchestrationJobRunner } from "./orchestration-job-runner.js";
import type { OrchestrationQueueStore } from "./orchestration-queue-store.js";

export interface TemporalEnqueueWorkflowInput {
  sessionId: string;
  topic: string;
  agents: string[];
  turns?: number;
}

export interface TemporalSignalWorkflowInput {
  sessionId: string;
  agent: string;
  payload?: unknown;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalRetryWorkflowInput extends TemporalSignalWorkflowInput {
  reason?: string;
}

export interface TemporalCompleteWorkflowInput {
  sessionId: string;
  agent: string;
  output?: unknown;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalFailWorkflowInput {
  sessionId: string;
  agent: string;
  error?: string;
  checkpoint?: Record<string, unknown>;
}

export interface TemporalWorkflowActivities {
  enqueueWorkflow(input: TemporalEnqueueWorkflowInput): Promise<void>;
  signalWorkflow(input: TemporalSignalWorkflowInput): Promise<WorkflowStepRecord>;
  retryWorkflow(input: TemporalRetryWorkflowInput): Promise<WorkflowStepRecord | null>;
  markDequeuedStep(input: { sessionId: string; agent: string }): Promise<WorkflowStepRecord | null>;
  completeWorkflowStep(input: TemporalCompleteWorkflowInput): Promise<WorkflowStepRecord | null>;
  failWorkflowStep(input: TemporalFailWorkflowInput): Promise<WorkflowStepRecord | null>;
}

export function createTemporalWorkflowActivities(options: {
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
}): TemporalWorkflowActivities {
  const { orchestrationQueueStore, orchestrationJobRunner } = options;

  return {
    async enqueueWorkflow(input): Promise<void> {
      if (!Array.isArray(input.agents) || input.agents.length === 0) {
        return;
      }

      const existingSteps = await orchestrationJobRunner.listSteps(input.sessionId);
      const nextStepIndex = existingSteps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;

      await orchestrationQueueStore.enqueue(input.sessionId, input.agents);

      await Promise.all(
        input.agents.map((agent, index) =>
          orchestrationJobRunner.enqueueStep({
            sessionId: input.sessionId,
            stepIndex: nextStepIndex + index,
            agent,
            payload: {
              topic: input.topic,
              turns: input.turns ?? null
            },
            checkpoint: {
              topic: input.topic,
              turns: input.turns ?? null
            }
          })
        )
      );
    },

    async signalWorkflow(input): Promise<WorkflowStepRecord> {
      const existingSteps = await orchestrationJobRunner.listSteps(input.sessionId);
      const nextStepIndex = existingSteps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
      return orchestrationJobRunner.enqueueStep({
        sessionId: input.sessionId,
        stepIndex: nextStepIndex,
        agent: input.agent,
        payload: input.payload,
        checkpoint: input.checkpoint
      });
    },

    async retryWorkflow(input): Promise<WorkflowStepRecord | null> {
      const existingSteps = await orchestrationJobRunner.listSteps(input.sessionId);
      const latestFailed = [...existingSteps]
        .sort((a, b) => b.stepIndex - a.stepIndex)
        .find((step) => step.agent === input.agent && step.status === "failed");
      const nextStepIndex = existingSteps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
      return orchestrationJobRunner.enqueueStep({
        sessionId: input.sessionId,
        stepIndex: nextStepIndex,
        agent: input.agent,
        payload: {
          retryOf: latestFailed?.stepIndex ?? null,
          reason: input.reason ?? null,
          payload: input.payload ?? null
        },
        checkpoint: {
          ...(input.checkpoint ?? {}),
          retryOf: latestFailed?.stepIndex ?? null,
          reason: input.reason ?? null
        }
      });
    },

    async markDequeuedStep(input): Promise<WorkflowStepRecord | null> {
      return orchestrationJobRunner.markDequeued(input.sessionId, input.agent);
    },

    async completeWorkflowStep(input): Promise<WorkflowStepRecord | null> {
      return orchestrationJobRunner.completeLatestRunningStep(input);
    },

    async failWorkflowStep(input): Promise<WorkflowStepRecord | null> {
      return orchestrationJobRunner.failLatestRunningStep({
        sessionId: input.sessionId,
        agent: input.agent,
        error: input.error ?? "unknown failure",
        checkpoint: input.checkpoint
      });
    }
  };
}

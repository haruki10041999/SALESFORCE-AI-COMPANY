import type { WorkflowEngine } from "../../core/ports/workflow-engine.js";
import type { OrchestrationJobRunner } from "./orchestration-job-runner.js";
import type { OrchestrationQueueStore } from "./orchestration-queue-store.js";

export interface CreateInProcessWorkflowEngineOptions {
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
}

export function createInProcessWorkflowEngine(
  options: CreateInProcessWorkflowEngineOptions
): WorkflowEngine {
  const { orchestrationQueueStore, orchestrationJobRunner } = options;

  return {
    async enqueue(input): Promise<void> {
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

    async signal(input) {
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

    async retry(input) {
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

    async listSteps(sessionId) {
      return orchestrationJobRunner.listSteps(sessionId);
    },

    async markDequeued(sessionId, agent) {
      return orchestrationJobRunner.markDequeued(sessionId, agent);
    },

    async completeStep(input) {
      return orchestrationJobRunner.completeLatestRunningStep(input);
    },

    async failStep(input) {
      return orchestrationJobRunner.failLatestRunningStep(input);
    }
  };
}
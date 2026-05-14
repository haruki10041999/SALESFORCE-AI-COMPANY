import type { WorkflowEngine, WorkflowRunHandle } from "../../core/ports/workflow-engine.js";
import { Client, Connection } from "@temporalio/client";
import { createLogger } from "../../core/logging/logger.js";
import { recordTemporalWorkflowOperationForPrometheus } from "../../core/observability/prometheus-metrics.js";
import {
  temporalWorkflowCompleteStep,
  temporalWorkflowEnqueueSignal,
  temporalWorkflowFailStep,
  temporalWorkflowMarkDequeued,
  temporalWorkflowReplayQuery,
  temporalWorkflowRetryStep,
  temporalWorkflowSignalStep,
  temporalWorkflowStateQuery,
  type TemporalWorkflowCompleteInput,
  type TemporalWorkflowFailInput,
  type TemporalWorkflowRetryInput,
  type TemporalWorkflowSignalInput
} from "./temporal-orchestrate-chat.workflow.js";

export interface CreateTemporalWorkflowEngineOptions {
  fallbackEngine: WorkflowEngine;
  allowFallbackToInProcess?: boolean;
  temporalAddress?: string;
  temporalNamespace?: string;
  taskQueue?: string;
  workflowType?: string;
  workflowRetryMaximumAttempts?: number;
  activityTimeoutSeconds?: number;
  activityRetryMaximumAttempts?: number;
  activityRetryInitialIntervalMs?: number;
  activityRetryBackoffCoefficient?: number;
  clientBundleFactory?: () => Promise<TemporalClientBundle | null>;
}

interface TemporalClientBundle {
  connection: Connection;
  client: Client;
}

type TemporalSignalOutcome = "success" | "unavailable" | "failed";

const logger = createLogger("TemporalWorkflowEngine");

/**
 * Phase2 TASK-06 POC:
 * Temporal runtime adapter shell.
 *
 * This keeps the current behavior by delegating to the in-process engine,
 * while exposing a Temporal mode and stable handle shape so callers can migrate
 * without further signature changes.
 */
export function createTemporalWorkflowEngine(
  options: CreateTemporalWorkflowEngineOptions
): WorkflowEngine {
  const { fallbackEngine } = options;
  const allowFallbackToInProcess = options.allowFallbackToInProcess ?? true;
  const temporalAddress = options.temporalAddress ?? "localhost:7233";
  const temporalNamespace = options.temporalNamespace ?? "default";
  const taskQueue = options.taskQueue ?? "sfai-orchestration";
  const workflowType = options.workflowType ?? "orchestrateChatWorkflow";
  const workflowRetryMaximumAttempts = options.workflowRetryMaximumAttempts ?? 1;
  const activityTimeoutSeconds = options.activityTimeoutSeconds ?? 60;
  const activityRetryMaximumAttempts = options.activityRetryMaximumAttempts ?? 3;
  const activityRetryInitialIntervalMs = options.activityRetryInitialIntervalMs ?? 1000;
  const activityRetryBackoffCoefficient = options.activityRetryBackoffCoefficient ?? 2;
  const clientBundleFactory = options.clientBundleFactory;
  let clientBundlePromise: Promise<TemporalClientBundle | null> | null = null;

  async function getTemporalClientBundle(): Promise<TemporalClientBundle | null> {
    if (clientBundlePromise) {
      return clientBundlePromise;
    }

    clientBundlePromise = (async () => {
      if (clientBundleFactory) {
        return clientBundleFactory();
      }
      try {
        const connection = await Connection.connect({ address: temporalAddress });
        const client = new Client({
          connection,
          namespace: temporalNamespace
        });
        return { connection, client };
      } catch {
        // If Temporal is unavailable, preserve behavior via fallback engine.
        return null;
      }
    })();

    return clientBundlePromise;
  }

  async function getTemporalHandle(sessionId: string) {
    const temporal = await getTemporalClientBundle();
    if (!temporal) {
      return null;
    }
    return temporal.client.workflow.getHandle(sessionId);
  }

  function recordFallback(operation: string, reason: string): void {
    logger.warn(`Temporal workflow ${operation} fell back to in-process (${reason})`);
    recordTemporalWorkflowOperationForPrometheus({
      operation,
      outcome: "fallback",
      fallbackReason: reason
    });
  }

  function buildTemporalUnavailableError(operation: string, reason: string): Error {
    return new Error(
      `Temporal workflow ${operation} failed (${reason}) and in-process fallback is disabled`
    );
  }

  function assertFallbackAllowed(operation: string, reason: string): void {
    if (allowFallbackToInProcess) {
      return;
    }
    recordTemporalWorkflowOperationForPrometheus({ operation, outcome: "failed", fallbackReason: reason });
    throw buildTemporalUnavailableError(operation, reason);
  }

  async function safeSignal(
    sessionId: string,
    operation: string,
    signalDef: string | object,
    payload: unknown
  ): Promise<TemporalSignalOutcome> {
    const handle = await getTemporalHandle(sessionId);
    if (!handle) {
      recordTemporalWorkflowOperationForPrometheus({ operation, outcome: "unavailable" });
      return "unavailable";
    }
    try {
      await handle.signal(signalDef as string, payload);
      recordTemporalWorkflowOperationForPrometheus({ operation, outcome: "success" });
      return "success";
    } catch {
      // Ignore Temporal sync failures and preserve fallback behavior.
      recordTemporalWorkflowOperationForPrometheus({ operation, outcome: "failed" });
      return "failed";
    }
  }

  async function findLatestStep(sessionId: string, agent: string) {
    const steps = await getTemporalStepsOrFallback(sessionId);
    return [...steps]
      .sort((a, b) => b.stepIndex - a.stepIndex)
      .find((step) => step.agent === agent) ?? null;
  }

  async function getTemporalStepsOrFallback(sessionId: string) {
    const handle = await getTemporalHandle(sessionId);
    if (!handle) {
      return fallbackEngine.replay(sessionId);
    }

    try {
      const result = await handle.query(temporalWorkflowReplayQuery);
      recordTemporalWorkflowOperationForPrometheus({ operation: "replay", outcome: "success" });
      return result;
    } catch {
      recordFallback("replay", "query_failed");
      return fallbackEngine.replay(sessionId);
    }
  }

  return {
    async start(input): Promise<WorkflowRunHandle> {
      let runId: string | undefined;
      let temporalStarted = false;

      const temporal = await getTemporalClientBundle();
      if (temporal) {
        try {
          const handle = await temporal.client.workflow.start(workflowType, {
            taskQueue,
            workflowId: input.sessionId,
            args: [
              {
                sessionId: input.sessionId,
                topic: input.topic,
                agents: input.agents,
                turns: input.turns,
                activityTimeoutSeconds,
                activityRetryMaximumAttempts,
                activityRetryInitialIntervalMs,
                activityRetryBackoffCoefficient
              }
            ],
            retry: {
              maximumAttempts: workflowRetryMaximumAttempts
            }
          });
          runId = handle.firstExecutionRunId;
          temporalStarted = true;
          recordTemporalWorkflowOperationForPrometheus({ operation: "start", outcome: "success" });
        } catch {
          recordTemporalWorkflowOperationForPrometheus({ operation: "start", outcome: "failed" });
          runId = undefined;
        }
      } else {
        recordTemporalWorkflowOperationForPrometheus({ operation: "start", outcome: "unavailable" });
      }

      if (!temporalStarted) {
        assertFallbackAllowed("start", temporal ? "start_failed" : "temporal_unavailable");
        recordFallback("start", temporal ? "start_failed" : "temporal_unavailable");
        await fallbackEngine.enqueue(input);
      }
      return {
        workflowId: input.sessionId,
        runId,
        sessionId: input.sessionId,
        mode: "temporal"
      };
    },

    async query(sessionId) {
      const handle = await getTemporalHandle(sessionId);
      if (!handle) {
        assertFallbackAllowed("query", "temporal_unavailable");
        recordFallback("query", "temporal_unavailable");
        return {
          ...(await fallbackEngine.query(sessionId)),
          mode: "temporal"
        };
      }

      try {
        const temporalResult = await handle.query(temporalWorkflowStateQuery);
        recordTemporalWorkflowOperationForPrometheus({ operation: "query", outcome: "success" });
        return {
          ...temporalResult,
          mode: "temporal"
        };
      } catch {
        assertFallbackAllowed("query", "query_failed");
        recordFallback("query", "query_failed");
        return {
          ...(await fallbackEngine.query(sessionId)),
          mode: "temporal"
        };
      }
    },

    async replay(sessionId) {
      return getTemporalStepsOrFallback(sessionId);
    },

    async enqueue(input) {
      const handle = await getTemporalHandle(input.sessionId);
      if (!handle) {
        assertFallbackAllowed("enqueue", "temporal_unavailable");
        recordFallback("enqueue", "temporal_unavailable");
        return fallbackEngine.enqueue(input);
      }
      const signaled = await safeSignal(input.sessionId, "enqueue", temporalWorkflowEnqueueSignal, input);
      if (signaled !== "success") {
        assertFallbackAllowed("enqueue", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("enqueue", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        await fallbackEngine.enqueue(input);
      }
    },

    async signal(input) {
      const handle = await getTemporalHandle(input.sessionId);
      if (!handle) {
        assertFallbackAllowed("signal", "temporal_unavailable");
        recordFallback("signal", "temporal_unavailable");
        return fallbackEngine.signal(input);
      }
      const temporalInput: TemporalWorkflowSignalInput = {
        sessionId: input.sessionId,
        agent: input.agent,
        payload: input.payload,
        checkpoint: input.checkpoint
      };
      const signaled = await safeSignal(input.sessionId, "signal", temporalWorkflowSignalStep, temporalInput);
      if (signaled !== "success") {
        assertFallbackAllowed("signal", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("signal", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        return fallbackEngine.signal(input);
      }
      return (await findLatestStep(input.sessionId, input.agent)) as NonNullable<Awaited<ReturnType<typeof fallbackEngine.signal>>>;
    },

    async retry(input) {
      const handle = await getTemporalHandle(input.sessionId);
      if (!handle) {
        assertFallbackAllowed("retry", "temporal_unavailable");
        recordFallback("retry", "temporal_unavailable");
        return fallbackEngine.retry(input);
      }
      const temporalInput: TemporalWorkflowRetryInput = {
        sessionId: input.sessionId,
        agent: input.agent,
        reason: input.reason,
        payload: input.payload,
        checkpoint: input.checkpoint
      };
      const signaled = await safeSignal(input.sessionId, "retry", temporalWorkflowRetryStep, temporalInput);
      if (signaled !== "success") {
        assertFallbackAllowed("retry", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("retry", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        return fallbackEngine.retry(input);
      }
      return findLatestStep(input.sessionId, input.agent);
    },

    async listSteps(sessionId) {
      return this.replay(sessionId);
    },

    async markDequeued(sessionId, agent) {
      const handle = await getTemporalHandle(sessionId);
      if (!handle) {
        assertFallbackAllowed("markDequeued", "temporal_unavailable");
        recordFallback("markDequeued", "temporal_unavailable");
        return fallbackEngine.markDequeued(sessionId, agent);
      }
      const signaled = await safeSignal(sessionId, "markDequeued", temporalWorkflowMarkDequeued, { sessionId, agent });
      if (signaled !== "success") {
        assertFallbackAllowed("markDequeued", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("markDequeued", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        return fallbackEngine.markDequeued(sessionId, agent);
      }
      return findLatestStep(sessionId, agent);
    },

    async completeStep(input) {
      const handle = await getTemporalHandle(input.sessionId);
      if (!handle) {
        assertFallbackAllowed("completeStep", "temporal_unavailable");
        recordFallback("completeStep", "temporal_unavailable");
        return fallbackEngine.completeStep(input);
      }
      const temporalInput: TemporalWorkflowCompleteInput = {
        sessionId: input.sessionId,
        agent: input.agent,
        output: input.output,
        checkpoint: input.checkpoint
      };
      const signaled = await safeSignal(input.sessionId, "completeStep", temporalWorkflowCompleteStep, temporalInput);
      if (signaled !== "success") {
        assertFallbackAllowed("completeStep", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("completeStep", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        return fallbackEngine.completeStep(input);
      }
      return findLatestStep(input.sessionId, input.agent);
    },

    async failStep(input) {
      const handle = await getTemporalHandle(input.sessionId);
      if (!handle) {
        assertFallbackAllowed("failStep", "temporal_unavailable");
        recordFallback("failStep", "temporal_unavailable");
        return fallbackEngine.failStep(input);
      }
      const temporalInput: TemporalWorkflowFailInput = {
        sessionId: input.sessionId,
        agent: input.agent,
        error: input.error instanceof Error ? input.error.message : String(input.error),
        checkpoint: input.checkpoint
      };
      const signaled = await safeSignal(input.sessionId, "failStep", temporalWorkflowFailStep, temporalInput);
      if (signaled !== "success") {
        assertFallbackAllowed("failStep", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        recordFallback("failStep", signaled === "failed" ? "signal_failed" : "temporal_unavailable");
        return fallbackEngine.failStep(input);
      }
      return findLatestStep(input.sessionId, input.agent);
    }
  };
}

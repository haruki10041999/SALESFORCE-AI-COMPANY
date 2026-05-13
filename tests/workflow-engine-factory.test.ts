import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrationJobRunner } from "../mcp/core/orchestration/job-runner.js";
import { createOrchestrationQueueStore } from "../mcp/core/orchestration/orchestration-queue-store.js";
import {
  getTemporalActivityRetryBackoffCoefficient,
  getTemporalActivityRetryInitialIntervalMs,
  getTemporalActivityRetryMaximumAttempts,
  getTemporalActivityTimeoutSeconds,
  getTemporalAddress,
  getTemporalNamespace,
  getTemporalRunWorkerEnabled,
  getTemporalTaskQueue,
  getTemporalWorkflowRetryMaximumAttempts,
  getWorkflowEngineMode
} from "../mcp/core/config/runtime-config.js";
import {
  _resetPrometheusForTest,
  getPrometheusMetricsText
} from "../mcp/core/observability/prometheus-metrics.js";
import type { WorkflowEngine, WorkflowStepRecord } from "../mcp/core/ports/workflow-engine.js";
import {
  temporalWorkflowCompleteStep,
  temporalWorkflowFailStep,
  temporalWorkflowMarkDequeued,
  temporalWorkflowReplayQuery,
  temporalWorkflowRetryStep,
  temporalWorkflowStateQuery,
  temporalWorkflowSignalStep
} from "../mcp/infrastructure/workflow/temporal-orchestrate-chat.workflow.js";
import { createTemporalWorkflowEngine } from "../mcp/infrastructure/workflow/temporal-workflow-engine.js";
import { createWorkflowEngine } from "../mcp/infrastructure/workflow/workflow-engine-factory.js";

test("workflow engine mode resolver defaults to in-process", () => {
  assert.equal(getWorkflowEngineMode("in-process", {}), "in-process");
});

test("workflow engine mode resolver accepts temporal", () => {
  assert.equal(getWorkflowEngineMode("in-process", { SF_AI_WORKFLOW_ENGINE: "temporal" }), "temporal");
});

test("temporal runtime config getters use defaults and env overrides", () => {
  assert.equal(getTemporalAddress("localhost:7233", {}), "localhost:7233");
  assert.equal(getTemporalNamespace("default", {}), "default");
  assert.equal(getTemporalTaskQueue("sfai-orchestration", {}), "sfai-orchestration");
  assert.equal(getTemporalWorkflowRetryMaximumAttempts(1, {}), 1);
  assert.equal(getTemporalActivityTimeoutSeconds(60, {}), 60);
  assert.equal(getTemporalActivityRetryMaximumAttempts(3, {}), 3);
  assert.equal(getTemporalActivityRetryInitialIntervalMs(1000, {}), 1000);
  assert.equal(getTemporalActivityRetryBackoffCoefficient(2, {}), 2);

  const env = {
    SF_AI_TEMPORAL_ADDRESS: "temporal:7233",
    SF_AI_TEMPORAL_NAMESPACE: "sfai",
    SF_AI_TEMPORAL_TASK_QUEUE: "orchestrate-chat",
    SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS: "2",
    SF_AI_TEMPORAL_ACTIVITY_TIMEOUT_SECONDS: "15",
    SF_AI_TEMPORAL_ACTIVITY_RETRY_MAX_ATTEMPTS: "5",
    SF_AI_TEMPORAL_ACTIVITY_RETRY_INITIAL_INTERVAL_MS: "250",
    SF_AI_TEMPORAL_ACTIVITY_RETRY_BACKOFF_COEFFICIENT: "1.5"
  };
  assert.equal(getTemporalAddress("localhost:7233", env), "temporal:7233");
  assert.equal(getTemporalNamespace("default", env), "sfai");
  assert.equal(getTemporalTaskQueue("sfai-orchestration", env), "orchestrate-chat");
  assert.equal(getTemporalWorkflowRetryMaximumAttempts(1, env), 2);
  assert.equal(getTemporalActivityTimeoutSeconds(60, env), 15);
  assert.equal(getTemporalActivityRetryMaximumAttempts(3, env), 5);
  assert.equal(getTemporalActivityRetryInitialIntervalMs(1000, env), 250);
  assert.equal(getTemporalActivityRetryBackoffCoefficient(2, env), 1.5);
  assert.equal(getTemporalRunWorkerEnabled(false, {}), false);
  assert.equal(getTemporalRunWorkerEnabled(false, { SF_AI_TEMPORAL_RUN_WORKER: "true" }), true);
});

test("workflow engine factory returns temporal-mode handle when temporal is enabled", async () => {
  const orchestrationQueueStore = await createOrchestrationQueueStore({ stateBackend: "memory" });
  const orchestrationJobRunner = createOrchestrationJobRunner({ stateBackend: "memory" });

  try {
    const workflowEngine = createWorkflowEngine(
      {
        orchestrationQueueStore,
        orchestrationJobRunner
      },
      { SF_AI_WORKFLOW_ENGINE: "temporal" }
    );

    const handle = await workflowEngine.start({
      sessionId: "wf-factory-1",
      topic: "phase2",
      agents: ["architect"]
    });

    assert.equal(handle.mode, "temporal");
    const query = await workflowEngine.query("wf-factory-1");
    assert.equal(query.mode, "temporal");
    assert.equal(query.steps.length, 1);
  } finally {
    await orchestrationQueueStore.close();
    await orchestrationJobRunner.close();
  }
});

test("temporal workflow engine uses Temporal query and signal paths when client is available", async () => {
  const temporalSteps: WorkflowStepRecord[] = [
    {
      sessionId: "temporal-session",
      stepIndex: 0,
      agent: "architect",
      status: "queued",
      attempt: 0
    }
  ];
  const signals: string[] = [];
  let fallbackQueryCalls = 0;
  let fallbackSignalCalls = 0;
  let fallbackRetryCalls = 0;
  let fallbackMarkDequeuedCalls = 0;
  let fallbackCompleteCalls = 0;
  let fallbackFailCalls = 0;

  const fallbackEngine: WorkflowEngine = {
    async start(input) {
      return { workflowId: input.sessionId, sessionId: input.sessionId, mode: "in-process" };
    },
    async query(sessionId) {
      fallbackQueryCalls += 1;
      return { sessionId, mode: "in-process", steps: [] };
    },
    async replay() {
      return [];
    },
    async enqueue() {
      return;
    },
    async signal() {
      fallbackSignalCalls += 1;
      return temporalSteps[0]!;
    },
    async retry() {
      fallbackRetryCalls += 1;
      return null;
    },
    async listSteps() {
      return [];
    },
    async markDequeued() {
      fallbackMarkDequeuedCalls += 1;
      return temporalSteps[0]!;
    },
    async completeStep() {
      fallbackCompleteCalls += 1;
      return temporalSteps[0]!;
    },
    async failStep() {
      fallbackFailCalls += 1;
      return temporalSteps[0]!;
    }
  };

  const fakeHandle = {
    async signal(def: string | { name: string }, payload: unknown) {
      const name = typeof def === "string" ? def : def.name;
      signals.push(name);
      if (name === temporalWorkflowSignalStep.name) {
        const input = payload as { sessionId: string; agent: string };
        temporalSteps.push({
          sessionId: input.sessionId,
          stepIndex: 1,
          agent: input.agent,
          status: "queued",
          attempt: 0
        });
      }
      if (name === temporalWorkflowMarkDequeued.name) {
        temporalSteps[0] = { ...temporalSteps[0]!, status: "running", attempt: 1 };
      }
      if (name === temporalWorkflowCompleteStep.name) {
        temporalSteps[0] = { ...temporalSteps[0]!, status: "completed", attempt: 1 };
      }
      if (name === temporalWorkflowRetryStep.name) {
        const input = payload as { sessionId: string; agent: string };
        temporalSteps.push({
          sessionId: input.sessionId,
          stepIndex: 2,
          agent: input.agent,
          status: "queued",
          attempt: 0
        });
      }
      if (name === temporalWorkflowFailStep.name) {
        temporalSteps[2] = { ...temporalSteps[2]!, status: "failed", attempt: 0 };
      }
    },
    async query(def: string | { name: string }) {
      const name = typeof def === "string" ? def : def.name;
      if (name === temporalWorkflowStateQuery.name) {
        return {
          sessionId: "temporal-session",
          mode: "temporal",
          steps: temporalSteps
        };
      }
      if (name === temporalWorkflowReplayQuery.name) {
        return temporalSteps;
      }
      return temporalSteps;
    }
  };

  const engine = createTemporalWorkflowEngine({
    fallbackEngine,
    clientBundleFactory: async () => ({
      connection: {} as never,
      client: {
        workflow: {
          async start() {
            return { firstExecutionRunId: "run-1" };
          },
          getHandle() {
            return fakeHandle;
          }
        }
      } as never
    })
  });

  const query = await engine.query("temporal-session");
  assert.equal(query.mode, "temporal");
  assert.equal(query.steps.length, 1);
  assert.equal(fallbackQueryCalls, 0);

  const signaled = await engine.signal({
    sessionId: "temporal-session",
    agent: "qa-engineer"
  });
  assert.equal(signaled.agent, "qa-engineer");

  const dequeued = await engine.markDequeued("temporal-session", "architect");
  assert.equal(dequeued?.status, "running");

  const completed = await engine.completeStep({
    sessionId: "temporal-session",
    agent: "architect"
  });
  assert.equal(completed?.status, "completed");

  const retried = await engine.retry({
    sessionId: "temporal-session",
    agent: "architect",
    reason: "rerun"
  });
  assert.equal(retried?.status, "queued");
  assert.equal(retried?.stepIndex, 2);

  temporalSteps[2] = { ...temporalSteps[2]!, status: "running", attempt: 1 };
  const failed = await engine.failStep({
    sessionId: "temporal-session",
    agent: "architect",
    error: new Error("boom")
  });
  assert.equal(failed?.status, "failed");

  assert.deepEqual(signals, [
    temporalWorkflowSignalStep.name,
    temporalWorkflowMarkDequeued.name,
    temporalWorkflowCompleteStep.name,
    temporalWorkflowRetryStep.name,
    temporalWorkflowFailStep.name
  ]);
  assert.equal(fallbackSignalCalls, 0);
  assert.equal(fallbackRetryCalls, 0);
  assert.equal(fallbackMarkDequeuedCalls, 0);
  assert.equal(fallbackCompleteCalls, 0);
  assert.equal(fallbackFailCalls, 0);
});

test("temporal workflow engine falls back when Temporal query or signal fails", async () => {
  await _resetPrometheusForTest();
  let fallbackQueryCalls = 0;
  let fallbackSignalCalls = 0;
  const fallbackStep: WorkflowStepRecord = {
    sessionId: "temporal-fallback",
    stepIndex: 0,
    agent: "qa-engineer",
    status: "queued",
    attempt: 0
  };

  const fallbackEngine: WorkflowEngine = {
    async start(input) {
      return { workflowId: input.sessionId, sessionId: input.sessionId, mode: "in-process" };
    },
    async query(sessionId) {
      fallbackQueryCalls += 1;
      return { sessionId, mode: "in-process", steps: [fallbackStep] };
    },
    async replay() {
      return [fallbackStep];
    },
    async enqueue() {
      return;
    },
    async signal() {
      fallbackSignalCalls += 1;
      return fallbackStep;
    },
    async retry() {
      return null;
    },
    async listSteps() {
      return [fallbackStep];
    },
    async markDequeued() {
      return fallbackStep;
    },
    async completeStep() {
      return fallbackStep;
    },
    async failStep() {
      return fallbackStep;
    }
  };

  const engine = createTemporalWorkflowEngine({
    fallbackEngine,
    clientBundleFactory: async () => ({
      connection: {} as never,
      client: {
        workflow: {
          async start() {
            return { firstExecutionRunId: "run-2" };
          },
          getHandle() {
            return {
              async signal() {
                throw new Error("signal failed");
              },
              async query() {
                throw new Error("query failed");
              }
            };
          }
        }
      } as never
    })
  });

  const query = await engine.query("temporal-fallback");
  assert.equal(query.steps[0]?.agent, "qa-engineer");
  assert.equal(fallbackQueryCalls, 1);

  const signal = await engine.signal({
    sessionId: "temporal-fallback",
    agent: "qa-engineer"
  });
  assert.equal(signal.agent, "qa-engineer");
  assert.equal(fallbackSignalCalls, 1);

  await new Promise<void>((resolve) => setImmediate(resolve));
  const { text } = await getPrometheusMetricsText();
  assert.ok(text.includes("sfai_temporal_workflow_operations_total"));
  assert.ok(text.includes('operation="query"'));
  assert.ok(text.includes('operation="signal"'));
  assert.ok(text.includes('reason="query_failed"'));
  assert.ok(text.includes('reason="signal_failed"'));
});

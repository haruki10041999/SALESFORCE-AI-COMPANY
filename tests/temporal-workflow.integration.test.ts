import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  getTemporalAddress,
  getTemporalNamespace
} from "../mcp/core/config/runtime-config.js";
import { createOrchestrationJobRunner } from "../mcp/core/orchestration/job-runner.js";
import { createOrchestrationQueueStore } from "../mcp/core/orchestration/orchestration-queue-store.js";
import { createInProcessWorkflowEngine } from "../mcp/infrastructure/workflow/in-process-workflow-engine.js";
import { createTemporalWorkflowActivities } from "../mcp/infrastructure/workflow/temporal-workflow-activities.js";
import { createTemporalWorkflowEngine } from "../mcp/infrastructure/workflow/temporal-workflow-engine.js";
import { createTemporalWorkflowWorker } from "../mcp/infrastructure/workflow/temporal-workflow-worker.js";

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 15000, intervalMs = 200): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

test("temporal workflow integration persists queue and step state through worker activities", async (t) => {
  if (process.env.SF_AI_TEMPORAL_INTEGRATION !== "true") {
    t.skip("Set SF_AI_TEMPORAL_INTEGRATION=true and start docker compose --profile workflow up -d temporalite temporal-ui");
    return;
  }

  const orchestrationQueueStore = await createOrchestrationQueueStore({ stateBackend: "memory" });
  const orchestrationJobRunner = createOrchestrationJobRunner({ stateBackend: "memory" });
  const temporalAddress = getTemporalAddress("localhost:7233", process.env);
  const temporalNamespace = getTemporalNamespace("default", process.env);
  const taskQueue = `sfai-orchestration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let worker: Awaited<ReturnType<typeof createTemporalWorkflowWorker>> | null = null;

  try {
    try {
      worker = await createTemporalWorkflowWorker({
        temporalAddress,
        temporalNamespace,
        taskQueue,
        activities: createTemporalWorkflowActivities({
          orchestrationQueueStore,
          orchestrationJobRunner
        })
      });
    } catch (error) {
      throw new Error(`Temporal unavailable while integration test is enabled: ${String(error)}`);
    }

    const engine = createTemporalWorkflowEngine({
      fallbackEngine: createInProcessWorkflowEngine({
        orchestrationQueueStore,
        orchestrationJobRunner
      }),
      temporalAddress,
      temporalNamespace,
      taskQueue,
      workflowRetryMaximumAttempts: 1,
      activityTimeoutSeconds: 10,
      activityRetryMaximumAttempts: 1,
      activityRetryInitialIntervalMs: 100,
      activityRetryBackoffCoefficient: 1
    });

    const sessionId = `temporal-integration-${Date.now()}`;
    const handle = await engine.start({
      sessionId,
      topic: "temporal integration",
      agents: ["architect"]
    });

    assert.equal(handle.mode, "temporal");

    const initialState = await waitFor(async () => {
      const query = await engine.query(sessionId);
      return query.steps.length === 1 ? query : null;
    });
    assert.equal(initialState.steps[0]?.status, "queued");

    const signaled = await engine.signal({
      sessionId,
      agent: "qa-engineer",
      checkpoint: { source: "integration-test" }
    });
    assert.equal(signaled.agent, "qa-engineer");

    const architectRunning = await engine.markDequeued(sessionId, "architect");
    assert.equal(architectRunning?.status, "running");
    const architectCompleted = await engine.completeStep({
      sessionId,
      agent: "architect",
      output: { summary: "done" }
    });
    assert.equal(architectCompleted?.status, "completed");

    const qaRunning = await engine.markDequeued(sessionId, "qa-engineer");
    assert.equal(qaRunning?.status, "running");
    const qaFailed = await engine.failStep({
      sessionId,
      agent: "qa-engineer",
      error: new Error("expected integration failure")
    });
    assert.equal(qaFailed?.status, "failed");

    const replay = await waitFor(async () => {
      const steps = await engine.replay(sessionId);
      return steps.length === 2 && steps.every((step) => step.status === "completed" || step.status === "failed")
        ? steps
        : null;
    });

    assert.deepEqual(
      replay.map((step) => ({ agent: step.agent, status: step.status })),
      [
        { agent: "architect", status: "completed" },
        { agent: "qa-engineer", status: "failed" }
      ]
    );
  } finally {
    if (worker) {
      await worker.close();
    }
    await orchestrationQueueStore.close();
    await orchestrationJobRunner.close();
  }
});
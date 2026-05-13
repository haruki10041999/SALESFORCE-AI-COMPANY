import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrationJobRunner } from "../mcp/core/orchestration/job-runner.js";
import { createOrchestrationQueueStore } from "../mcp/core/orchestration/orchestration-queue-store.js";
import { createInProcessWorkflowEngine } from "../mcp/infrastructure/workflow/in-process-workflow-engine.js";

test("in-process workflow engine enqueues queue items and step records", async () => {
  const orchestrationQueueStore = await createOrchestrationQueueStore({ stateBackend: "memory" });
  const orchestrationJobRunner = createOrchestrationJobRunner({ stateBackend: "memory" });
  const workflowEngine = createInProcessWorkflowEngine({
    orchestrationQueueStore,
    orchestrationJobRunner
  });

  try {
    await workflowEngine.enqueue({
      sessionId: "session-1",
      topic: "review pipeline",
      agents: ["architect", "qa-engineer"],
      turns: 2
    });

    const queuedAgents = await orchestrationQueueStore.dequeue("session-1", 10);
    const steps = await orchestrationJobRunner.listSteps("session-1");

    assert.deepEqual(queuedAgents, ["architect", "qa-engineer"]);
    assert.deepEqual(
      steps.map((step) => ({
        stepIndex: step.stepIndex,
        agent: step.agent,
        status: step.status,
        attempt: step.attempt
      })),
      [
        { stepIndex: 0, agent: "architect", status: "queued", attempt: 0 },
        { stepIndex: 1, agent: "qa-engineer", status: "queued", attempt: 0 }
      ]
    );
    assert.deepEqual(steps[0]?.checkpointJson, { topic: "review pipeline", turns: 2 });
  } finally {
    await orchestrationQueueStore.close();
    await orchestrationJobRunner.close();
  }
});

test("in-process workflow engine appends step indexes after existing records", async () => {
  const orchestrationQueueStore = await createOrchestrationQueueStore({ stateBackend: "memory" });
  const orchestrationJobRunner = createOrchestrationJobRunner({ stateBackend: "memory" });
  const workflowEngine = createInProcessWorkflowEngine({
    orchestrationQueueStore,
    orchestrationJobRunner
  });

  try {
    await orchestrationJobRunner.enqueueStep({
      sessionId: "session-2",
      stepIndex: 0,
      agent: "ceo"
    });

    await workflowEngine.enqueue({
      sessionId: "session-2",
      topic: "follow-up",
      agents: ["architect", "qa-engineer"]
    });

    const steps = await orchestrationJobRunner.listSteps("session-2");
    assert.deepEqual(
      steps.map((step) => ({ stepIndex: step.stepIndex, agent: step.agent })),
      [
        { stepIndex: 0, agent: "ceo" },
        { stepIndex: 1, agent: "architect" },
        { stepIndex: 2, agent: "qa-engineer" }
      ]
    );
  } finally {
    await orchestrationQueueStore.close();
    await orchestrationJobRunner.close();
  }
});

test("in-process workflow engine exposes step lifecycle operations", async () => {
  const orchestrationQueueStore = await createOrchestrationQueueStore({ stateBackend: "memory" });
  const orchestrationJobRunner = createOrchestrationJobRunner({ stateBackend: "memory" });
  const workflowEngine = createInProcessWorkflowEngine({
    orchestrationQueueStore,
    orchestrationJobRunner
  });

  try {
    await workflowEngine.enqueue({
      sessionId: "session-3",
      topic: "lifecycle",
      agents: ["architect"]
    });

    const dequeued = await workflowEngine.markDequeued("session-3", "architect");
    assert.equal(dequeued?.status, "running");
    assert.equal(dequeued?.attempt, 1);

    const completed = await workflowEngine.completeStep({
      sessionId: "session-3",
      agent: "architect",
      output: { summary: "done" },
      checkpoint: { stage: "completed" }
    });
    assert.equal(completed?.status, "completed");
    assert.deepEqual(completed?.checkpointJson, { stage: "completed" });

    const steps = await workflowEngine.listSteps("session-3");
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.status, "completed");
  } finally {
    await orchestrationQueueStore.close();
    await orchestrationJobRunner.close();
  }
});
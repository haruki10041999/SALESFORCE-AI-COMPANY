import assert from "node:assert/strict";
import test from "node:test";
import { createOrchestrationJobRunner } from "../mcp/core/orchestration/job-runner.js";
import { runWithTenantContext } from "../mcp/core/identity/tenant-context.js";

test("in-memory orchestration job runner tracks queued running completed steps", async () => {
  const runner = createOrchestrationJobRunner({ stateBackend: "sqlite" });
  try {
    await runner.enqueueStep({ sessionId: "sess-1", stepIndex: 0, agent: "architect", payload: { a: 1 } });
    await runner.enqueueStep({ sessionId: "sess-1", stepIndex: 1, agent: "qa-engineer", payload: { a: 2 } });

    const running = await runner.markDequeued("sess-1", "architect");
    assert.equal(running?.status, "running");
    assert.equal(running?.attempt, 1);

    const completed = await runner.completeLatestRunningStep({
      sessionId: "sess-1",
      agent: "architect",
      output: { ok: true }
    });
    assert.equal(completed?.status, "completed");

    const steps = await runner.listSteps("sess-1");
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.status, "completed");
    assert.equal(steps[1]?.status, "queued");
  } finally {
    await runner.close();
  }
});

test("in-memory orchestration job runner isolates steps by tenant", async () => {
  const runner = createOrchestrationJobRunner({ stateBackend: "sqlite" });
  try {
    await runWithTenantContext("tenant-a", async () => {
      await runner.enqueueStep({ sessionId: "sess-shared", stepIndex: 0, agent: "architect", payload: { a: 1 } });
    });
    await runWithTenantContext("tenant-b", async () => {
      await runner.enqueueStep({ sessionId: "sess-shared", stepIndex: 0, agent: "qa-engineer", payload: { a: 2 } });
    });

    const stepsA = await runWithTenantContext("tenant-a", async () => runner.listSteps("sess-shared"));
    const stepsB = await runWithTenantContext("tenant-b", async () => runner.listSteps("sess-shared"));

    assert.equal(stepsA.length, 1);
    assert.equal(stepsB.length, 1);
    assert.equal(stepsA[0]?.agent, "architect");
    assert.equal(stepsB[0]?.agent, "qa-engineer");
  } finally {
    await runner.close();
  }
});

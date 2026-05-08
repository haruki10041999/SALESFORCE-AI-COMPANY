import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createOrchestrationJobRunner } from "../mcp/core/orchestration/job-runner.js";

test("postgres orchestration job runner persists step lifecycle", async (t) => {
  let container: StartedPostgreSqlContainer | undefined;
  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
      .withDatabase("sfai")
      .withUsername("sfai")
      .withPassword("sfai")
      .start();
  } catch (error) {
    t.skip(`Docker/Testcontainers unavailable: ${String(error)}`);
    return;
  }

  const runner = createOrchestrationJobRunner({
    stateBackend: "postgres",
    databaseUrl: container.getConnectionUri()
  });

  try {
    await runner.enqueueStep({ sessionId: "sess-pg", stepIndex: 0, agent: "architect", payload: { topic: "x" } });
    await runner.enqueueStep({ sessionId: "sess-pg", stepIndex: 1, agent: "qa-engineer", payload: { topic: "y" } });

    const running = await runner.markDequeued("sess-pg", "architect");
    assert.equal(running?.status, "running");

    const completed = await runner.completeLatestRunningStep({
      sessionId: "sess-pg",
      agent: "architect",
      output: { done: true }
    });
    assert.equal(completed?.status, "completed");

    const steps = await runner.listSteps("sess-pg");
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.status, "completed");
    assert.equal(steps[1]?.status, "queued");
  } finally {
    await runner.close();
    await container.stop();
  }
});

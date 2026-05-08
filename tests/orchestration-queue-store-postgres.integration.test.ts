import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createOrchestrationQueueStore } from "../mcp/core/orchestration/orchestration-queue-store.js";

test("pg-boss orchestration queue store replaces and dequeues in order", async (t) => {
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

  const store = await createOrchestrationQueueStore({
    stateBackend: "postgres",
    databaseUrl: container.getConnectionUri(),
    queuePrefix: "test-orch"
  });

  try {
    await store.replace("sess-pg-1", ["agent-a", "agent-b", "agent-c"]);

    const first = await store.dequeue("sess-pg-1", 2);
    const second = await store.dequeue("sess-pg-1", 2);
    const third = await store.dequeue("sess-pg-1", 1);

    assert.deepEqual(first, ["agent-a", "agent-b"]);
    assert.deepEqual(second, ["agent-c"]);
    assert.deepEqual(third, []);
  } finally {
    await store.close();
    await container.stop();
  }
});

test("pg-boss orchestration queue store clear removes queued agents", async (t) => {
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

  const store = await createOrchestrationQueueStore({
    stateBackend: "postgres",
    databaseUrl: container.getConnectionUri(),
    queuePrefix: "test-orch"
  });

  try {
    await store.replace("sess-pg-2", ["agent-a", "agent-b"]);
    await store.clear("sess-pg-2");
    const next = await store.dequeue("sess-pg-2", 5);

    assert.deepEqual(next, []);
  } finally {
    await store.close();
    await container.stop();
  }
});

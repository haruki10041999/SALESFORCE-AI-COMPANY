import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresOrchestrationSessionStore } from "../mcp/core/context/postgres-orchestration-session-store.js";

test("postgres orchestration session store persists and restores session", async (t) => {
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

  const registry = new Map<string, { id: string; history: Array<{ role: string; message: string }> }>();
  const session = {
    id: "orch-postgres-test",
    history: [{ role: "agent", message: "hello postgres" }]
  };
  registry.set(session.id, session);

  const store = await PostgresOrchestrationSessionStore.open({
    databaseUrl: container.getConnectionUri(),
    getSession: (sessionId) => registry.get(sessionId),
    setSession: (value) => {
      registry.set(value.id, value);
    }
  });

  try {
    const saved = await store.saveOrchestrationSession(session.id);
    assert.ok(saved);
    assert.equal(saved?.historyCount, 1);

    registry.clear();
    const restored = await store.restoreOrchestrationSession(session.id);
    assert.ok(restored);
    assert.equal(restored?.id, session.id);
    assert.equal(restored?.history[0]?.message, "hello postgres");
  } finally {
    await store.close();
    await container.stop();
  }
});
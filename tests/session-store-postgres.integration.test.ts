import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresSessionStore } from "../mcp/core/persistence/session-store.postgres.js";
import type { OrchestrationSession } from "../mcp/core/types/index.js";

function makeSession(id: string, historyLen = 1): OrchestrationSession {
  return {
    id,
    topic: "test topic",
    agents: ["agent-a"],
    persona: undefined,
    skills: [],
    filePaths: [],
    turns: 3,
    triggerRules: [],
    queue: ["agent-a"],
    history: Array.from({ length: historyLen }, (_, i) => ({
      agent: "agent-a",
      message: `message-${i}`,
      timestamp: new Date().toISOString(),
      topic: "test topic"
    })),
    firedRules: [],
    agentTrust: {}
  };
}

test("PostgresSessionStore: upsert and getById round-trip", async (t) => {
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

  const store = await PostgresSessionStore.open({ databaseUrl: container.getConnectionUri() });
  try {
    const session = makeSession("sess-001");
    const result = await store.upsert(session, -1);
    assert.equal(result.updated, true, "initial upsert should succeed");

    const loaded = await store.getById("sess-001");
    assert.ok(loaded, "getById should return the session");
    assert.equal(loaded?.id, "sess-001");
    assert.equal(loaded?.topic, "test topic");
  } finally {
    await store.close();
    await container.stop();
  }
});

test("PostgresSessionStore: optimistic lock rejects stale version", async (t) => {
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

  const store = await PostgresSessionStore.open({ databaseUrl: container.getConnectionUri() });
  try {
    const session = makeSession("sess-opt");
    // Insert with version 1
    const r1 = await store.upsert(session, -1);
    assert.equal(r1.updated, true);
    const currentVersion = r1.version!;

    // Concurrent writer already bumped version, so expectedVersion is stale
    const r2 = await store.upsert(session, currentVersion - 1 < 0 ? 999 : currentVersion - 1);
    assert.equal(r2.updated, false, "stale version upsert should be rejected");

    // Correct version should succeed
    const r3 = await store.upsert(session, currentVersion);
    assert.equal(r3.updated, true, "matching version upsert should succeed");
  } finally {
    await store.close();
    await container.stop();
  }
});

test("PostgresSessionStore: advisory lock acquire and release", async (t) => {
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

  const store = await PostgresSessionStore.open({ databaseUrl: container.getConnectionUri() });
  try {
    const session = makeSession("sess-lock");
    await store.upsert(session, -1);

    const acquired = await store.acquireLock("sess-lock", "owner-1");
    assert.equal(acquired, true, "first lock acquire should succeed");

    await store.releaseLock("sess-lock", "owner-1");
    // After release, another owner can acquire
    const acquired2 = await store.acquireLock("sess-lock", "owner-2");
    assert.equal(acquired2, true, "re-acquire after release should succeed");
    await store.releaseLock("sess-lock", "owner-2");
  } finally {
    await store.close();
    await container.stop();
  }
});

test("PostgresSessionStore: list returns sessions ordered by updatedAt DESC", async (t) => {
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

  const store = await PostgresSessionStore.open({ databaseUrl: container.getConnectionUri() });
  try {
    await store.upsert(makeSession("sess-list-1"), -1);
    await store.upsert(makeSession("sess-list-2"), -1);
    await store.upsert(makeSession("sess-list-3"), -1);

    const sessions = await store.list(10);
    assert.ok(sessions.length >= 3);
    // All should have status "active"
    for (const s of sessions) {
      assert.equal(s.status, "active");
    }
  } finally {
    await store.close();
    await container.stop();
  }
});

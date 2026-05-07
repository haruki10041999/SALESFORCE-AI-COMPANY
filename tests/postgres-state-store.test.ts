import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresStateStore } from "../mcp/core/persistence/postgres-store.js";

test("postgres state store persists governance row", async (t) => {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    try {
      container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
        .withDatabase("sfai")
        .withUsername("sfai")
        .withPassword("sfai")
        .start();
      databaseUrl = container.getConnectionUri();
    } catch (error) {
      t.skip(`Docker/Testcontainers unavailable: ${String(error)}`);
      return;
    }
  }

  const store = await PostgresStateStore.open({
    databaseUrl
  });

  try {
    const payload = {
      config: { maxCounts: { skills: 150, tools: 150, presets: 150 } },
      updatedAt: new Date().toISOString()
    };
    await store.upsertGovernanceStateRow(JSON.stringify(payload), payload.updatedAt);

    const row = await store.getGovernanceStateRow();
    assert.ok(row);
    assert.equal(row?.stateJson.includes("maxCounts"), true);
  } finally {
    await store.close();
    if (container) {
      await container.stop();
    }
  }
});

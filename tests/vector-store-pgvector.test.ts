import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  addRecord,
  clearRecords,
  resetVectorBackendForTest,
  searchByKeywordAsync
} from "../memory/vector-store.js";

test("vector-store pgvector backend works with SF_AI_VECTOR_BACKEND=pgvector", async (t) => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;

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

  const oldBackend = process.env.SF_AI_VECTOR_BACKEND;
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const oldEmbeddingProvider = process.env.EMBEDDING_PROVIDER;

  process.env.SF_AI_VECTOR_BACKEND = "pgvector";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.EMBEDDING_PROVIDER = "ngram";
  resetVectorBackendForTest();

  try {
    clearRecords();
    addRecord({ id: "flow-1", text: "salesforce flow approval route", tags: ["flow"] });
    addRecord({ id: "apex-1", text: "apex trigger bulkification", tags: ["apex"] });

    const results = await searchByKeywordAsync("approval flow", { limit: 5, minScore: -1 });
    assert.ok(results.length > 0);
    assert.ok(results.some((row) => row.id === "flow-1"));
  } finally {
    process.env.SF_AI_VECTOR_BACKEND = oldBackend;
    process.env.DATABASE_URL = oldDatabaseUrl;
    process.env.EMBEDDING_PROVIDER = oldEmbeddingProvider;
    resetVectorBackendForTest();
    if (container) {
      await container.stop();
    }
  }
});

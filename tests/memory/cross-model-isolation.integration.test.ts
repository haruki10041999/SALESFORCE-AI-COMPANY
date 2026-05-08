import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PgvectorVectorStoreAdapter } from "../../memory/adapters/pgvector-vector-store.js";
import type { EmbeddingProvider } from "../../memory/vector-store-adapter.js";
import type { VectorEmbeddingProvider } from "../../mcp/core/llm/embedding-provider.js";

function makeProvider(modelName: string, dim: number, score: number): EmbeddingProvider & VectorEmbeddingProvider {
  const fv = Array.from<number>({ length: dim }).fill(score);
  return {
    name: "ngram" as VectorEmbeddingProvider["name"],
    dimension: dim,
    search: () => [],
    embed: async () => fv,
    embedBatch: async (texts: ReadonlyArray<string>) => texts.map(() => fv),
    // expose real model name via a non-typed property used in adapter lookup
    toString: () => modelName
  } as unknown as EmbeddingProvider & VectorEmbeddingProvider;
}

// Helper that creates a provider whose `name` field equals the given model name (for adapter write/read).
function makeNamedProvider(modelName: string, dim: number, score: number) {
  const base = makeProvider(modelName, dim, score);
  return Object.assign(base, { name: modelName as VectorEmbeddingProvider["name"] });
}

test("pgvector adapter isolates rows by embedding model and dimension", async (t) => {
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

  try {
    const connUri = container.getConnectionUri();

    // Write with model-A (dim 768)
    const adapterA = new PgvectorVectorStoreAdapter(connUri);
    adapterA.configureEmbeddingProviderForTest(makeNamedProvider("model-a", 768, 0.5) as unknown as EmbeddingProvider);
    adapterA.addRecord({ id: "r1", text: "hello world", tags: [] });
    await adapterA.flushPendingWrites();

    // Write with model-B (dim 768) — same dimension but different model
    const adapterB = new PgvectorVectorStoreAdapter(connUri);
    adapterB.configureEmbeddingProviderForTest(makeNamedProvider("model-b", 768, 0.9) as unknown as EmbeddingProvider);
    adapterB.addRecord({ id: "r2", text: "hello world", tags: [] });
    await adapterB.flushPendingWrites();

    // Search with model-A should find only r1, not r2
    const resultsA = await adapterA.searchByKeywordAsync("hello world", { limit: 10 });
    const idsA = resultsA.map((r) => r.id);
    assert.ok(idsA.includes("r1"), "model-A search should include its own record");
    assert.ok(!idsA.includes("r2"), "model-A search should not include model-B records");

    // Search with model-B should find only r2
    const resultsB = await adapterB.searchByKeywordAsync("hello world", { limit: 10 });
    const idsB = resultsB.map((r) => r.id);
    assert.ok(idsB.includes("r2"), "model-B search should include its own record");
    assert.ok(!idsB.includes("r1"), "model-B search should not include model-A records");
  } finally {
    await container.stop();
  }
});

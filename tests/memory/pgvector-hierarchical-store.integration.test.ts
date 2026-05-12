import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MemoryChunker } from "../../memory/chunker.js";
import { NgramEmbeddingProvider } from "../../mcp/core/llm/embedding-provider.js";
import { PgvectorHierarchicalStore } from "../../mcp/infrastructure/memory/pgvector-hierarchical-store.js";

test("PgvectorHierarchicalStore ingests and finds chunk matches", async (t) => {
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

  const store = new PgvectorHierarchicalStore({
    chunker: new MemoryChunker(),
    databaseUrl: container.getConnectionUri(),
    embeddingProvider: new NgramEmbeddingProvider({ dimension: 768 })
  });

  try {
    const doc = `## AI Platform\nThis section explains the Salesforce AI platform architecture.\n\n## Security\nThis section explains tenant isolation and permission controls.`;

    const ingest = await store.ingest({
      id: "doc-pg-1",
      title: "Platform Guide",
      content: doc,
      isMarkdown: true
    });

    assert.equal(ingest.documentId, "doc-pg-1");
    assert.ok(ingest.sections >= 2);
    assert.ok(ingest.chunks > 0);

    const hits = await store.search({
      query: "tenant isolation",
      expandTo: "chunk",
      limit: 5,
      minScore: 0,
      withContext: true
    });

    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.type, "chunk");
    assert.equal(hits[0]?.documentId, "doc-pg-1");
    assert.ok(hits.some((h) => h.text.toLowerCase().includes("tenant isolation")));
    assert.ok(hits.some((h) => h.context?.sectionSummary));
  } finally {
    await store.close();
    await container.stop();
  }
});

test("PgvectorHierarchicalStore supports section/document expansion", async (t) => {
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

  const store = new PgvectorHierarchicalStore({
    chunker: new MemoryChunker(),
    databaseUrl: container.getConnectionUri(),
    embeddingProvider: new NgramEmbeddingProvider({ dimension: 768 })
  });

  try {
    await store.ingest({
      id: "doc-pg-2",
      title: "Runbook",
      content: `## Incident\nTroubleshooting steps for production issues.\n\n## Recovery\nRecovery checklist and validation tasks.`,
      isMarkdown: true
    });

    const sectionHits = await store.search({
      query: "recovery checklist",
      expandTo: "section",
      limit: 3,
      minScore: 0
    });

    assert.ok(sectionHits.length > 0);
    assert.ok(sectionHits.every((h) => h.type === "section"));

    const docHits = await store.search({
      query: "production issues",
      expandTo: "document",
      limit: 3,
      minScore: 0
    });

    assert.ok(docHits.length > 0);
    assert.ok(docHits.every((h) => h.type === "document"));
    assert.ok(docHits.some((h) => h.documentId === "doc-pg-2"));
  } finally {
    await store.close();
    await container.stop();
  }
});

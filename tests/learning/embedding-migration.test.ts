import assert from "node:assert/strict";
import test from "node:test";
import { buildEmbeddingMigrationPlan, getEmbeddingProfileId, selectRowsForMigration } from "../../mcp/core/learning/embedding-migration.js";

test("embedding migration helper resolves stable profile ids", () => {
  assert.equal(
    getEmbeddingProfileId({ name: "ngram", dimension: 256, profileId: undefined }),
    "ngram:256"
  );
  assert.equal(
    getEmbeddingProfileId({ name: "ollama", dimension: 768, profileId: "ollama:nomic-embed-text" }),
    "ollama:nomic-embed-text"
  );
});

test("embedding migration helper selects rows that need re-embedding", () => {
  const rows = [
    { id: "1", tenantId: null, text: "a", tags: [], embeddingModel: "ngram:256", embeddingDim: 256 },
    { id: "2", tenantId: null, text: "b", tags: [], embeddingModel: "ollama:nomic-embed-text", embeddingDim: 768 },
    { id: "3", tenantId: null, text: "c", tags: [], embeddingModel: "legacy-768", embeddingDim: 768 }
  ];

  const selected = selectRowsForMigration(rows, { name: "ollama", dimension: 768, profileId: "ollama:nomic-embed-text" });
  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.id, "1");
  assert.equal(selected[1]?.id, "3");

  const plan = buildEmbeddingMigrationPlan(rows, { name: "ollama", dimension: 768, profileId: "ollama:nomic-embed-text" });
  assert.equal(plan.totalRows, 3);
  assert.equal(plan.rowsToMigrate, 2);
  assert.equal(plan.rowsAlreadyCurrent, 1);
  assert.equal(plan.target.profileId, "ollama:nomic-embed-text");
});

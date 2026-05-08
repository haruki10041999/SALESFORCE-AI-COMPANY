import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addRelation,
  clearKnowledgeGraph,
  configureKnowledgeGraphStorageForTest,
  ingestKnowledgeSummary,
  searchHybrid,
  searchKnowledgeEntities,
  upsertEntity
} from "../../memory/knowledge-graph.js";
import { addRecord, clearRecords, configureVectorStoreForTest } from "../../memory/vector-store.js";

function setupIsolatedPaths() {
  const base = mkdtempSync(join(tmpdir(), "knowledge-graph-test-"));
  const graphFile = join(base, "knowledge-graph.json");
  const vectorFile = join(base, "vector-store.jsonl");
  configureKnowledgeGraphStorageForTest(graphFile);
  configureVectorStoreForTest(vectorFile);
  clearKnowledgeGraph();
  clearRecords();
}

test("knowledge graph ingests summary and finds entities", () => {
  setupIsolatedPaths();

  const result = ingestKnowledgeSummary([
    "Project: Atlas Runtime",
    "Org: Platform Team",
    "Decision: Adopt pgvector",
    "Tech: TypeScript"
  ].join("\n"));

  assert.ok(result.entities.length >= 4);

  const found = searchKnowledgeEntities("atlas");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.name, "Atlas Runtime");
});

test("knowledge graph accumulates relation weight on repeated relation", () => {
  setupIsolatedPaths();

  upsertEntity({ type: "project", name: "Atlas Runtime" });
  upsertEntity({ type: "tech_stack", name: "pgvector" });

  const first = addRelation({
    srcName: "Atlas Runtime",
    srcType: "project",
    relationType: "relates_to",
    dstName: "pgvector",
    dstType: "tech_stack",
    evidence: "design note"
  });

  const second = addRelation({
    srcName: "Atlas Runtime",
    srcType: "project",
    relationType: "relates_to",
    dstName: "pgvector",
    dstType: "tech_stack",
    evidence: "review note"
  });

  assert.ok(second.weight > first.weight);
});

test("searchHybrid merges vector and graph contexts", async () => {
  setupIsolatedPaths();

  ingestKnowledgeSummary([
    "Project: Atlas Runtime",
    "Org: Platform Team",
    "Tech: TypeScript"
  ].join("\n"));

  addRecord({
    id: "kg-test-1",
    text: "Atlas Runtime migration note for TypeScript services",
    tags: ["knowledge", "atlas"]
  });

  const result = await searchHybrid("atlas", { vectorK: 5, graphHops: 1 });

  assert.ok(result.vectorResults.length > 0);
  assert.ok(result.seedEntities.length > 0);
  assert.ok(result.neighborEntities.length > 0);
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  configureKnowledgeGraphStorageForTest,
  clearKnowledgeGraph,
  upsertEntity,
  addRelation
} from "../../memory/knowledge-graph.js";
import type { KnowledgeEntityType } from "../../memory/graph-extractor.js";
import {
  inferTransitiveRelations,
  findSimilarEntities,
  detectCommunities
} from "../../mcp/core/memory/kg-reasoner.js";

function setupIsolatedGraph(): void {
  const base = mkdtempSync(join(tmpdir(), "kg-reasoner-test-"));
  configureKnowledgeGraphStorageForTest(join(base, "knowledge-graph.json"));
  clearKnowledgeGraph();
}

function addEntity(type: KnowledgeEntityType, name: string): string {
  return upsertEntity({ type, name }).id;
}

test("inferTransitiveRelations infers missing edge through intermediate nodes", () => {
  setupIsolatedGraph();

  const a = addEntity("project", "A");
  const b = addEntity("tech_stack", "B");
  const c = addEntity("tech_stack", "C");

  addRelation({ srcName: "A", srcType: "project", relationType: "relates_to", dstName: "B", dstType: "tech_stack" });
  addRelation({ srcName: "B", srcType: "tech_stack", relationType: "relates_to", dstName: "C", dstType: "tech_stack" });

  const inferred = inferTransitiveRelations({ relationType: "relates_to", maxDepth: 3 });
  const found = inferred.find((row) => row.srcId === a && row.dstId === c);

  assert.ok(found, "A -> C should be inferred transitively");
  assert.ok((found?.via ?? []).includes(b));
});

test("findSimilarEntities returns neighbors with overlap score", () => {
  setupIsolatedGraph();

  addEntity("project", "P1");
  addEntity("project", "P2");
  addEntity("project", "P3");
  addEntity("tech_stack", "T1");
  addEntity("tech_stack", "T2");

  addRelation({ srcName: "P1", srcType: "project", relationType: "uses", dstName: "T1", dstType: "tech_stack" });
  addRelation({ srcName: "P1", srcType: "project", relationType: "uses", dstName: "T2", dstType: "tech_stack" });
  addRelation({ srcName: "P2", srcType: "project", relationType: "uses", dstName: "T1", dstType: "tech_stack" });
  addRelation({ srcName: "P3", srcType: "project", relationType: "uses", dstName: "T2", dstType: "tech_stack" });

  const p1Id = "project:p1";
  const similar = findSimilarEntities(p1Id, { limit: 5 });

  assert.ok(similar.length >= 1);
  assert.equal(similar[0]?.entityId, "project:p2");
  assert.ok((similar[0]?.score ?? 0) > 0);
});

test("detectCommunities groups connected components", () => {
  setupIsolatedGraph();

  addEntity("project", "Alpha");
  addEntity("tech_stack", "Node");
  addEntity("project", "Beta");
  addEntity("organization", "Ops Team");

  addRelation({ srcName: "Alpha", srcType: "project", relationType: "uses", dstName: "Node", dstType: "tech_stack" });
  addRelation({ srcName: "Beta", srcType: "project", relationType: "owned_by", dstName: "Ops Team", dstType: "organization" });

  const communities = detectCommunities();

  assert.ok(communities.length >= 2);
  assert.ok(communities.every((group) => group.members.length >= 1));
});

import assert from "node:assert/strict";
import test from "node:test";
import { memoryRecordsTable } from "../../db/schema/memory.js";

test("memoryRecordsTable has embeddingModel column with correct default", () => {
  const col = memoryRecordsTable.embeddingModel;
  assert.ok(col, "embeddingModel column should exist");
});

test("memoryRecordsTable has embeddingDim column with correct default", () => {
  const col = memoryRecordsTable.embeddingDim;
  assert.ok(col, "embeddingDim column should exist");
});

test("memoryRecordsTable has embeddingNorm column", () => {
  const col = memoryRecordsTable.embeddingNorm;
  assert.ok(col, "embeddingNorm column should exist");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  clearRecords,
  configureVectorStoreForTest,
  searchByKeyword
} from "../memory/vector-store.js";

test("vector-store large load applies streaming retention cap after 10k+ records", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "sf-ai-vector-large-load-test-"));
  const tempStorage = join(tempRoot, "vector-store.jsonl");

  try {
    const lines: string[] = [];
    for (let i = 0; i < 12050; i += 1) {
      lines.push(JSON.stringify({
        id: `id-${i}`,
        text: `record-${i}`,
        tags: ["bulk", "stream"]
      }));
    }
    writeFileSync(tempStorage, `${lines.join("\n")}\n`, "utf-8");

    configureVectorStoreForTest(tempStorage);

    const broad = searchByKeyword("bulk");
    assert.ok(broad.length <= 5000, `expected <= 5000 records, got ${broad.length}`);

    const oldest = searchByKeyword("record-0");
    assert.equal(oldest.length, 0, "oldest record should be trimmed by retention");

    const newest = searchByKeyword("record-12049");
    assert.equal(newest.length, 1, "newest record should remain searchable");
    assert.equal(newest[0]?.id, "id-12049");
  } finally {
    clearRecords();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

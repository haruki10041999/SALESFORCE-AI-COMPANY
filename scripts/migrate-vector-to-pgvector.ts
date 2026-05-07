import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PgvectorVectorStoreAdapter } from "../memory/adapters/pgvector-vector-store.js";
import type { MemoryRecord } from "../memory/vector-store-adapter.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vectorFile = process.env.SF_AI_VECTOR_STORE_FILE ?? join(root, "outputs", "vector-store.jsonl");

function loadRecords(filePath: string): MemoryRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as MemoryRecord;
      } catch {
        return null;
      }
    })
    .filter((row): row is MemoryRecord => {
      return !!row && typeof row.id === "string" && typeof row.text === "string" && Array.isArray(row.tags);
    });
}

async function main(): Promise<void> {
  const records = loadRecords(vectorFile);
  if (records.length === 0) {
    process.stdout.write(`[migrate-vector-to-pgvector] no records found at ${vectorFile}\n`);
    return;
  }

  const adapter = new PgvectorVectorStoreAdapter();
  for (const record of records) {
    adapter.addRecord(record);
  }
  await adapter.flushPendingWrites();
  process.stdout.write(`[migrate-vector-to-pgvector] migrated ${records.length} records\n`);
}

main().catch((error) => {
  process.stderr.write(`[migrate-vector-to-pgvector] failed: ${String(error)}\n`);
  process.exitCode = 1;
});

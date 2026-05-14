import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

test("event store append call sites are inventory-tracked", async () => {
  const mcpRoot = resolve(process.cwd(), "mcp");
  const files = await walk(mcpRoot);

  const offenders: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    const hasAppendCall = /eventStore\.appendWithOutbox\(|eventStore\.append\(/.test(text);
    if (!hasAppendCall) continue;

    const normalized = file.replace(/\\/g, "/");
    if (!normalized.endsWith("/mcp/core/learning/learning-orchestrator.ts")) {
      offenders.push(normalized);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Unexpected eventStore append callsites found outside learning orchestrator: ${offenders.join(", ")}`
  );
});

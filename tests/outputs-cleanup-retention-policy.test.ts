import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { cleanupOutputsByRetentionPolicy } from "../mcp/core/governance/outputs-cleanup.js";

async function touchFile(filePath: string, ageDays: number): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "data", "utf-8");
  const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await utimes(filePath, past, past);
}

test("cleanupOutputsByRetentionPolicy applies classification-specific retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-cleanup-retention-"));
  const outputsDir = join(root, "outputs");

  const oldEvent = join(outputsDir, "events", "old-event.jsonl");
  const oldReport = join(outputsDir, "reports", "old-report.md");
  const oldHistory = join(outputsDir, "history", "old-history.json");

  try {
    await Promise.all([
      touchFile(oldEvent, 100),
      touchFile(oldReport, 100),
      touchFile(oldHistory, 100)
    ]);

    const summary = cleanupOutputsByRetentionPolicy(
      outputsDir,
      { dryRun: false },
      {
        SF_AI_RETENTION_DAYS_PUBLIC: "365",
        SF_AI_RETENTION_DAYS_INTERNAL: "180",
        SF_AI_RETENTION_DAYS_CONFIDENTIAL: "90"
      }
    );

    assert.equal(summary.totalRemoved, 1);
    const removedFiles = summary.results.flatMap((item) => item.result.removedFiles);
    assert.equal(removedFiles.length, 1);
    assert.equal(removedFiles[0]?.action, "removed");
    await assert.rejects(stat(oldEvent));
    await stat(oldReport);
    await stat(oldHistory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOutputsByRetentionPolicy supports dry-run", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-cleanup-retention-dry-"));
  const outputsDir = join(root, "outputs");
  const oldEvent = join(outputsDir, "events", "old-event.jsonl");

  try {
    await touchFile(oldEvent, 200);

    const summary = cleanupOutputsByRetentionPolicy(
      outputsDir,
      { dryRun: true },
      { SF_AI_RETENTION_DAYS_CONFIDENTIAL: "90" }
    );

    assert.equal(summary.totalRemoved, 1);
    const removedFiles = summary.results.flatMap((item) => item.result.removedFiles);
    assert.equal(removedFiles.length, 1);
    assert.equal(removedFiles[0]?.action, "dry-run");
    await stat(oldEvent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

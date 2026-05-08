import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { cleanupOutputs, parseCleanupArgs } from "../mcp/core/governance/outputs-cleanup.js";

async function touchFile(filePath: string, ageDays: number): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "data", "utf-8");
  const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await utimes(filePath, past, past);
}

test("cleanupOutputs removes old generated outputs recursively but preserves non-target files", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-cleanup-"));
  const outputsDir = join(root, "outputs");

  const oldHistory = join(outputsDir, "history", "2026-04-01", "chat.json");
  const oldSession = join(outputsDir, "sessions", "nested", "session.json");
  const oldReport = join(outputsDir, "reports", "agent-ab-test", "old-run.json");
  const oldDashboard = join(outputsDir, "dashboards", "observability.md");
  const oldBenchmark = join(outputsDir, "benchmark", "2026-03-01.json");

  const eventLog = join(outputsDir, "events", "system-events.jsonl");
  const protectedGovernance = join(outputsDir, "resource-governance.json");
  const freshReport = join(outputsDir, "reports", "fresh.json");

  try {
    await Promise.all([
      touchFile(oldHistory, 40),
      touchFile(oldSession, 40),
      touchFile(oldReport, 40),
      touchFile(oldDashboard, 40),
      touchFile(oldBenchmark, 40),
      touchFile(eventLog, 40),
      touchFile(protectedGovernance, 40),
      touchFile(freshReport, 2)
    ]);

    const summary = cleanupOutputs(outputsDir, { days: 30, dryRun: false });

    assert.equal(summary.totalRemoved, 5);
    const removedFiles = summary.results.flatMap((item) => item.result.removedFiles);
    assert.equal(removedFiles.length, 5);
    assert.ok(removedFiles.every((item) => item.action === "removed"));

    await assert.rejects(stat(oldHistory));
    await assert.rejects(stat(oldSession));
    await assert.rejects(stat(oldReport));
    await assert.rejects(stat(oldDashboard));
    await assert.rejects(stat(oldBenchmark));

    await stat(eventLog);
    await stat(protectedGovernance);
    await stat(freshReport);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOutputs dry-run reports old generated outputs without deleting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-cleanup-dry-"));
  const outputsDir = join(root, "outputs");
  const oldReport = join(outputsDir, "reports", "coverage-gap", "old.md");

  try {
    await touchFile(oldReport, 45);

    const summary = cleanupOutputs(outputsDir, { days: 30, dryRun: true });
    const remaining = await readdir(join(outputsDir, "reports", "coverage-gap"));

    assert.equal(summary.totalRemoved, 1);
    const removedFiles = summary.results.flatMap((item) => item.result.removedFiles);
    assert.equal(removedFiles.length, 1);
    assert.equal(removedFiles[0]?.action, "dry-run");
    assert.deepEqual(remaining, ["old.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parseCleanupArgs supports retention policy and audit flags", () => {
  const parsed = parseCleanupArgs(["--days", "45", "--dry-run", "--retention-policy", "--no-audit-log"]);
  assert.equal(parsed.days, 45);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.useRetentionPolicy, true);
  assert.equal(parsed.auditLog, false);
});
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSnapshot } from "../mcp/core/governance/outputs-versioning.js";
import { runVerifyBackup } from "../scripts/dr/verify-backup.js";
import { runDrRestore } from "../scripts/dr/restore.js";

test("runVerifyBackup reports success on valid snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-dr-verify-"));
  const outputsDir = join(root, "outputs");
  const backupsDir = join(outputsDir, "backups");

  try {
    await mkdir(join(outputsDir, "reports"), { recursive: true });
    await mkdir(join(outputsDir, "events"), { recursive: true });
    await writeFile(join(outputsDir, "events", "system-events.jsonl"), "{}\n", "utf-8");
    createSnapshot(outputsDir, backupsDir, "s1", false);

    const report = await runVerifyBackup({
      outputsDir,
      snapshot: "s1",
      minEntries: 1,
      reportPath: join(outputsDir, "reports", "backup-verify-latest.json")
    });

    assert.equal(report.ok, true);
    assert.equal(report.snapshot, "s1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runDrRestore dry-run creates report", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-dr-restore-"));
  const outputsDir = join(root, "outputs");
  const backupsDir = join(outputsDir, "backups");
  const reportPath = join(outputsDir, "reports", "dr-restore-latest.json");

  try {
    await mkdir(join(outputsDir, "reports"), { recursive: true });
    await mkdir(join(outputsDir, "events"), { recursive: true });
    await writeFile(join(outputsDir, "events", "system-events.jsonl"), "{}\n", "utf-8");
    createSnapshot(outputsDir, backupsDir, "restore-1", false);

    const report = await runDrRestore({
      outputsDir,
      snapshot: "restore-1",
      dryRun: true,
      skipPreBackup: false,
      reportPath
    });

    const persisted = JSON.parse(await readFile(reportPath, "utf-8")) as { dryRun: boolean; snapshot: string };
    assert.equal(report.dryRun, true);
    assert.equal(report.snapshot, "restore-1");
    assert.equal(persisted.dryRun, true);
    assert.equal(persisted.snapshot, "restore-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

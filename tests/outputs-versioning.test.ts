import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSnapshot,
  parseOutputsVersioningArgs,
  restoreSnapshot,
  wipeOutputs
} from "../mcp/core/governance/outputs-versioning.js";

test("parseOutputsVersioningArgs accepts wipe and keeps backups", () => {
  const options = parseOutputsVersioningArgs(["wipe", "--name", "nightly-reset"]);

  assert.equal(options.command, "wipe");
  assert.equal(options.snapshotName, "nightly-reset");
  assert.equal(options.keepBackups, true);
  assert.equal(options.skipPreBackup, false);
});

test("wipeOutputs removes outputs entries but preserves backups directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-versioning-wipe-"));
  const outputsDir = join(root, "outputs");
  const backupsDir = join(outputsDir, "backups");

  try {
    await mkdir(join(outputsDir, "events"), { recursive: true });
    await mkdir(join(outputsDir, "reports"), { recursive: true });
    await mkdir(join(backupsDir, "snapshot-1"), { recursive: true });

    await Promise.all([
      writeFile(join(outputsDir, "events", "system-events.jsonl"), "events", "utf-8"),
      writeFile(join(outputsDir, "reports", "report.json"), "report", "utf-8"),
      writeFile(join(backupsDir, "snapshot-1", "_meta.json"), "{}", "utf-8")
    ]);

    const wiped = wipeOutputs(outputsDir, backupsDir, false);
    const remaining = await readdir(outputsDir);

    assert.deepEqual(wiped.removedEntries.sort(), ["events", "reports"]);
    assert.deepEqual(remaining, ["backups"]);
    await stat(join(backupsDir, "snapshot-1", "_meta.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restoreSnapshot rebuilds outputs after wipe", async () => {
  const root = await mkdtemp(join(tmpdir(), "outputs-versioning-restore-"));
  const outputsDir = join(root, "outputs");
  const backupsDir = join(outputsDir, "backups");

  try {
    await mkdir(join(outputsDir, "events"), { recursive: true });
    await mkdir(join(outputsDir, "reports"), { recursive: true });
    await writeFile(join(outputsDir, "events", "system-events.jsonl"), "events", "utf-8");
    await writeFile(join(outputsDir, "reports", "report.json"), "report", "utf-8");

    createSnapshot(outputsDir, backupsDir, "snapshot-restore", false);
    wipeOutputs(outputsDir, backupsDir, false);

    const afterWipe = await readdir(outputsDir);
    assert.deepEqual(afterWipe, ["backups"]);

    const restored = restoreSnapshot(outputsDir, backupsDir, "snapshot-restore", false);
    const restoredEntries = await readdir(outputsDir);
    const restoredReport = await readFile(join(outputsDir, "reports", "report.json"), "utf-8");

    assert.deepEqual(restored.restoredEntries.sort(), ["events", "reports"]);
    assert.deepEqual(restoredEntries.sort(), ["backups", "events", "reports"]);
    assert.equal(restoredReport, "report");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
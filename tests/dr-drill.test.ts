import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDrDrillArgs, runDrDrill } from "../scripts/dr-drill.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sfai-dr-drill-"));
}

test("parseDrDrillArgs defaults to dry-run with generated snapshot name", () => {
  const options = parseDrDrillArgs([]);

  assert.equal(options.execute, false);
  assert.ok(options.snapshotName.startsWith("dr-drill-"));
});

test("runDrDrill dry-run writes a report without requiring db urls", async () => {
  const tempDir = createTempDir();
  const reportPath = join(tempDir, "dr-drill-report.json");

  try {
    const report = await runDrDrill({
      execute: false,
      snapshotName: "dr-drill-test",
      primaryUrl: "",
      replicaUrl: "",
      reportPath,
      keepSnapshots: 3
    });

    assert.equal(report.dryRun, true);
    assert.ok(report.notes.some((note) => note.includes("dry-run")));
    assert.ok(existsSync(reportPath));

    const persisted = JSON.parse(readFileSync(reportPath, "utf-8")) as { dryRun: boolean; snapshot: { id: string } };
    assert.equal(persisted.dryRun, true);
    assert.equal(persisted.snapshot.id, "dr-drill-test");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { replaySiemDeadLetter } from "../scripts/replay-siem-dead-letter.js";

test("replaySiemDeadLetter replays deduplicated rows from dead-letter file", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-siem-replay-"));
  const outputsDir = join(root, "outputs");
  const auditDir = join(outputsDir, "audit");
  const reportsDir = join(outputsDir, "reports");
  const deadLetterPath = join(auditDir, "siem-export.dead-letter.jsonl");
  const reportPath = join(reportsDir, "siem-dead-letter-replay-latest.json");

  try {
    await mkdir(auditDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      deadLetterPath,
      `${JSON.stringify({ rows: [
        {
          id: 10,
          ts: "2026-05-13T00:00:00.000Z",
          tenantId: "tenant-a",
          actorType: "user",
          actorId: "u-1",
          action: "proposal.approve",
          resourceType: "skills",
          resourceId: "skill-a",
          payloadJson: { ok: true }
        }
      ] })}\n${JSON.stringify({ rows: [
        {
          id: 10,
          ts: "2026-05-13T00:00:00.000Z",
          tenantId: "tenant-a",
          actorType: "user",
          actorId: "u-1",
          action: "proposal.approve",
          resourceType: "skills",
          resourceId: "skill-a",
          payloadJson: { ok: true }
        },
        {
          id: 11,
          ts: "2026-05-13T00:01:00.000Z",
          tenantId: "tenant-a",
          actorType: "agent",
          actorId: "architect",
          action: "policy.evaluate",
          resourceType: "tools",
          resourceId: "tool-a",
          payloadJson: { score: 0.91 }
        }
      ] })}\n`,
      "utf-8"
    );

    const result = await replaySiemDeadLetter({
      provider: "ndjson",
      outputsDir,
      deadLetterPath,
      reportPath,
      batchSize: 100,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      dryRun: false
    });

    assert.equal(result.replayedRowCount, 2);
    assert.equal(result.report.exportedCount, 2);
    const ndjson = await readFile(join(auditDir, "siem-export.jsonl"), "utf-8");
    assert.ok(ndjson.includes("proposal.approve"));
    assert.ok(ndjson.includes("policy.evaluate"));
    const persisted = JSON.parse(await readFile(reportPath, "utf-8")) as { replayedRowCount: number };
    assert.equal(persisted.replayedRowCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

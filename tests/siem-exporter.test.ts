import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportAuditRowsToSiem,
  exportRecentAuditToSiem,
  toSiemPayload,
  type AuditLogLike
} from "../mcp/core/audit/siem-exporter.js";

function sampleRows(): AuditLogLike[] {
  return [
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
  ];
}

test("toSiemPayload maps Splunk payload shape", () => {
  const payload = toSiemPayload(sampleRows()[0], "splunk-hec");
  assert.equal(typeof payload.time, "number");
  assert.equal(typeof payload.event, "object");
});

test("exportAuditRowsToSiem writes ndjson output", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-siem-"));
  try {
    const report = await exportAuditRowsToSiem(sampleRows(), {
      provider: "ndjson",
      outputsDir: root,
      dryRun: false
    });

    const content = await readFile(join(root, "audit", "siem-export.jsonl"), "utf-8");
    assert.equal(report.exportedCount, 2);
    assert.equal(report.metrics.batchesSucceeded, 1);
    assert.ok(content.includes("proposal.approve"));
    assert.ok(content.includes("policy.evaluate"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportRecentAuditToSiem respects cursor and exports only new rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-siem-cursor-"));
  try {
    await mkdir(join(root, "audit"), { recursive: true });
    await writeFile(
      join(root, "audit", "siem-export.cursor.json"),
      JSON.stringify({ lastExportedId: 10 }),
      "utf-8"
    );

    const report = await exportRecentAuditToSiem(
      {
        list: async () => sampleRows()
      },
      {
        provider: "ndjson",
        outputsDir: root,
        dryRun: true
      }
    );

    assert.equal(report.exportedCount, 1);
    assert.equal(report.lastExportedId, 11);
    assert.ok(report.metrics.durationMs >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportAuditRowsToSiem retries transient HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("busy", { status: 503, statusText: "Service Unavailable" });
    }
    return new Response("ok", { status: 200, statusText: "OK" });
  }) as typeof fetch;

  try {
    const report = await exportAuditRowsToSiem(sampleRows(), {
      provider: "splunk-hec",
      endpoint: "https://example.local/hec",
      token: "dummy",
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      dryRun: false
    });

    assert.equal(report.exportedCount, 2);
    assert.equal(report.metrics.retryCount, 1);
    assert.equal(report.metrics.httpRequestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exportAuditRowsToSiem writes dead-letter when retries are exhausted", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-siem-dead-letter-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("down", { status: 503, statusText: "Service Unavailable" });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => exportAuditRowsToSiem(sampleRows(), {
        provider: "splunk-hec",
        endpoint: "https://example.local/hec",
        token: "dummy",
        outputsDir: root,
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 2,
        dryRun: false
      }),
      /SIEM export failed/
    );

    const deadLetter = await readFile(join(root, "audit", "siem-export.dead-letter.jsonl"), "utf-8");
    assert.ok(deadLetter.includes("rowIds"));
    assert.ok(deadLetter.includes("10"));
    assert.ok(deadLetter.includes("11"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

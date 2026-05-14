#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { exportAuditRowsToSiem, type AuditLogLike, type SiemProvider } from "../mcp/core/audit/siem-exporter.js";
import { getOutputsDir } from "../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../mcp/core/persistence/atomic-file.js";
import { PgBossOutboxPort } from "../mcp/infrastructure/outbox/pgboss-outbox.js";

interface DeadLetterEntry {
  timestamp?: string;
  provider?: string;
  endpoint?: string;
  reason?: string;
  batchSize?: number;
  rowIds?: number[];
  rows?: AuditLogLike[];
}

interface CliOptions {
  provider: SiemProvider;
  endpoint?: string;
  token?: string;
  outputsDir: string;
  deadLetterPath: string;
  reportPath: string;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  databaseUrl?: string;
  outboxTopic?: string;
  outboxQueuePrefix?: string;
  outboxDispatchLimit?: number;
  dryRun: boolean;
}

function parseProvider(value: string | undefined): SiemProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "splunk-hec" || normalized === "datadog-http" || normalized === "ndjson") {
    return normalized;
  }
  return "ndjson";
}

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      endpoint: { type: "string" },
      token: { type: "string" },
      "outputs-dir": { type: "string" },
      "dead-letter-path": { type: "string" },
      "report-path": { type: "string" },
      "batch-size": { type: "string" },
      "max-retries": { type: "string" },
      "retry-base-ms": { type: "string" },
      "retry-max-ms": { type: "string" },
      "database-url": { type: "string" },
      "outbox-topic": { type: "string" },
      "outbox-queue-prefix": { type: "string" },
      "outbox-dispatch-limit": { type: "string" },
      "dry-run": { type: "boolean", default: false }
    },
    allowPositionals: false,
    args: argv
  });

  const outputsDir = values["outputs-dir"]?.trim() || getOutputsDir("outputs");
  const batchSize = Number.parseInt(values["batch-size"] ?? "200", 10);
  const maxRetries = Number.parseInt(values["max-retries"] ?? process.env.SF_AI_SIEM_MAX_RETRIES ?? "2", 10);
  const retryBaseDelayMs = Number.parseInt(values["retry-base-ms"] ?? process.env.SF_AI_SIEM_RETRY_BASE_MS ?? "250", 10);
  const retryMaxDelayMs = Number.parseInt(values["retry-max-ms"] ?? process.env.SF_AI_SIEM_RETRY_MAX_MS ?? "5000", 10);
  const outboxDispatchLimit = Number.parseInt(values["outbox-dispatch-limit"] ?? "200", 10);

  return {
    provider: parseProvider(values.provider ?? process.env.SF_AI_SIEM_PROVIDER),
    endpoint: values.endpoint?.trim() ?? process.env.SF_AI_SIEM_ENDPOINT?.trim(),
    token: values.token?.trim() ?? process.env.SF_AI_SIEM_TOKEN?.trim(),
    outputsDir,
    deadLetterPath: values["dead-letter-path"]?.trim() || join(outputsDir, "audit", "siem-export.dead-letter.jsonl"),
    reportPath: values["report-path"]?.trim() || join(outputsDir, "reports", "siem-dead-letter-replay-latest.json"),
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 200,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 2,
    retryBaseDelayMs: Number.isFinite(retryBaseDelayMs) && retryBaseDelayMs > 0 ? retryBaseDelayMs : 250,
    retryMaxDelayMs: Number.isFinite(retryMaxDelayMs) && retryMaxDelayMs > 0 ? retryMaxDelayMs : 5000,
    databaseUrl: values["database-url"]?.trim() ?? process.env.DATABASE_URL?.trim(),
    outboxTopic: values["outbox-topic"]?.trim(),
      outboxQueuePrefix: values["outbox-queue-prefix"]?.trim() || "outbox",
      outboxDispatchLimit: Number.isFinite(outboxDispatchLimit) && outboxDispatchLimit > 0 ? outboxDispatchLimit : 200,
    dryRun: values["dry-run"]
  };
}

async function loadDeadLetterRows(deadLetterPath: string): Promise<AuditLogLike[]> {
  const raw = await readFile(deadLetterPath, "utf-8");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dedup = new Map<number, AuditLogLike>();

  for (const line of lines) {
    const entry = JSON.parse(line) as DeadLetterEntry;
    for (const row of entry.rows ?? []) {
      dedup.set(row.id, row);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => a.id - b.id);
}

export async function replaySiemDeadLetter(options: CliOptions) {
  const rows = await loadDeadLetterRows(options.deadLetterPath);

  if (options.outboxTopic) {
    if (!options.databaseUrl) {
      throw new Error("--outbox-topic を使う場合は --database-url (または DATABASE_URL) が必要です");
    }

    const outbox = await PgBossOutboxPort.open({
      databaseUrl: options.databaseUrl,
      queuePrefix: options.outboxQueuePrefix ?? "outbox"
    });
    try {
      await outbox.enqueue({
        topic: options.outboxTopic,
        payload: {
          source: "siem-dead-letter-replay",
          provider: options.provider,
          endpoint: options.endpoint ?? null,
          rows
        },
        dedupeKey: `siem-dead-letter:${rows.map((row) => row.id).join(",")}`
      });
      const dispatch = await outbox.dispatchPending({ limit: options.outboxDispatchLimit ?? 200 });
      const replayReport = {
        deadLetterPath: options.deadLetterPath,
        replayedRowCount: rows.length,
        mode: "outbox",
        outboxTopic: options.outboxTopic,
        report: {
          exportedCount: 0,
          failedCount: dispatch.failed,
          deadLetterCount: dispatch.failed
        },
        dispatch
      };
      await writeTextFileAtomic(options.reportPath, `${JSON.stringify(replayReport, null, 2)}\n`);
      return replayReport;
    } finally {
      await outbox.close();
    }
  }

  const report = await exportAuditRowsToSiem(rows, {
    provider: options.provider,
    endpoint: options.endpoint,
    token: options.token,
    outputsDir: options.outputsDir,
    batchSize: options.batchSize,
    maxRetries: options.maxRetries,
    retryBaseDelayMs: options.retryBaseDelayMs,
    retryMaxDelayMs: options.retryMaxDelayMs,
    dryRun: options.dryRun
  });

  const replayReport = {
    deadLetterPath: options.deadLetterPath,
    replayedRowCount: rows.length,
    mode: "direct",
    report
  };
  await writeTextFileAtomic(options.reportPath, `${JSON.stringify(replayReport, null, 2)}\n`);
  return replayReport;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = await replaySiemDeadLetter(options);
  console.log(JSON.stringify(report, null, 2));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

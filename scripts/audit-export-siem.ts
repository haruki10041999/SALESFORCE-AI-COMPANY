#!/usr/bin/env tsx
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AuditWriter } from "../mcp/core/audit/audit-writer.js";
import { exportRecentAuditToSiem, type SiemProvider } from "../mcp/core/audit/siem-exporter.js";
import { getPrimaryDatabaseUrl, getOutputsDir } from "../mcp/core/config/runtime-config.js";
import { writeTextFileAtomic } from "../mcp/core/persistence/atomic-file.js";

interface CliOptions {
  provider: SiemProvider;
  endpoint?: string;
  token?: string;
  limit: number;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  continueOnBatchError: boolean;
  deadLetterFilePath?: string;
  dryRun: boolean;
  outputsDir: string;
  reportPath: string;
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
      limit: { type: "string" },
      "batch-size": { type: "string" },
      "max-retries": { type: "string" },
      "retry-base-ms": { type: "string" },
      "retry-max-ms": { type: "string" },
      "continue-on-batch-error": { type: "boolean", default: false },
      "dead-letter-path": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "outputs-dir": { type: "string" },
      "report-path": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  const limit = Number.parseInt(values.limit ?? "500", 10);
  const batchSize = Number.parseInt(values["batch-size"] ?? "200", 10);
  const maxRetries = Number.parseInt(values["max-retries"] ?? process.env.SF_AI_SIEM_MAX_RETRIES ?? "2", 10);
  const retryBaseDelayMs = Number.parseInt(values["retry-base-ms"] ?? process.env.SF_AI_SIEM_RETRY_BASE_MS ?? "250", 10);
  const retryMaxDelayMs = Number.parseInt(values["retry-max-ms"] ?? process.env.SF_AI_SIEM_RETRY_MAX_MS ?? "5000", 10);
  const outputsDir = values["outputs-dir"]?.trim() || getOutputsDir("outputs");

  return {
    provider: parseProvider(values.provider ?? process.env.SF_AI_SIEM_PROVIDER),
    endpoint: values.endpoint?.trim() ?? process.env.SF_AI_SIEM_ENDPOINT?.trim(),
    token: values.token?.trim() ?? process.env.SF_AI_SIEM_TOKEN?.trim(),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 200,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 2,
    retryBaseDelayMs: Number.isFinite(retryBaseDelayMs) && retryBaseDelayMs > 0 ? retryBaseDelayMs : 250,
    retryMaxDelayMs: Number.isFinite(retryMaxDelayMs) && retryMaxDelayMs > 0 ? retryMaxDelayMs : 5000,
    continueOnBatchError: values["continue-on-batch-error"],
    deadLetterFilePath: values["dead-letter-path"]?.trim(),
    dryRun: values["dry-run"],
    outputsDir,
    reportPath: values["report-path"]?.trim() || join(outputsDir, "reports", "siem-export-latest.json")
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const dbUrl = getPrimaryDatabaseUrl();
  if (!dbUrl) {
    throw new Error("DATABASE_URL or SF_AI_DB_URL_PRIMARY is required");
  }

  const writer = await AuditWriter.open({ databaseUrl: dbUrl });
  try {
    const report = await exportRecentAuditToSiem(writer, {
      provider: options.provider,
      endpoint: options.endpoint,
      token: options.token,
      limit: options.limit,
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      retryMaxDelayMs: options.retryMaxDelayMs,
      continueOnBatchError: options.continueOnBatchError,
      deadLetterFilePath: options.deadLetterFilePath,
      dryRun: options.dryRun,
      outputsDir: options.outputsDir
    });

    await writeTextFileAtomic(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await writer.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

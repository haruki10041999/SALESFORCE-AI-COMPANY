import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getOutputsDir } from "../config/runtime-config.js";

export type SiemProvider = "splunk-hec" | "datadog-http" | "ndjson";

export interface AuditLogLike {
  id: number;
  ts: string;
  tenantId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payloadJson: Record<string, unknown>;
}

export interface SiemExportOptions {
  provider: SiemProvider;
  endpoint?: string;
  token?: string;
  limit?: number;
  batchSize?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryOnStatuses?: number[];
  continueOnBatchError?: boolean;
  dryRun?: boolean;
  outputsDir?: string;
  cursorFilePath?: string;
  deadLetterFilePath?: string;
  startAfterId?: number;
}

export interface SiemExportMetrics {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  batchesTotal: number;
  batchesSucceeded: number;
  batchesFailed: number;
  retryCount: number;
  httpRequestCount: number;
  deadLetterCount: number;
  errors: string[];
}

export interface SiemExportReport {
  provider: SiemProvider;
  dryRun: boolean;
  exportedCount: number;
  skippedCount: number;
  lastExportedId: number | null;
  target: string;
  metrics: SiemExportMetrics;
}

class SiemHttpError extends Error {
  constructor(public readonly status: number, statusText: string) {
    super(`SIEM export failed: ${status} ${statusText}`);
    this.name = "SiemHttpError";
  }
}

interface RetryConfig {
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryOnStatuses: Set<number>;
}

function resolveRetryConfig(options: SiemExportOptions): RetryConfig {
  const retryOnStatuses = new Set<number>(
    (options.retryOnStatuses ?? [408, 409, 425, 429, 500, 502, 503, 504])
      .filter((status) => Number.isFinite(status) && status >= 400)
      .map((status) => Math.trunc(status))
  );
  return {
    maxRetries: Math.max(0, Math.trunc(options.maxRetries ?? 2)),
    retryBaseDelayMs: Math.max(50, Math.trunc(options.retryBaseDelayMs ?? 250)),
    retryMaxDelayMs: Math.max(100, Math.trunc(options.retryMaxDelayMs ?? 5000)),
    retryOnStatuses
  };
}

function isRetryableStatus(status: number, config: RetryConfig): boolean {
  return config.retryOnStatuses.has(status) || status >= 500;
}

function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error instanceof SiemHttpError) {
    return isRetryableStatus(error.status, config);
  }
  return true;
}

function backoffDelayMs(attempt: number, config: RetryConfig): number {
  const exp = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** Math.max(0, attempt - 1)));
  return Math.trunc(exp + Math.random() * Math.max(0, Math.trunc(exp * 0.1)));
}

async function sleepMs(delayMs: number): Promise<void> {
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, delayMs));
  });
}

function initMetrics(startedAt: Date): SiemExportMetrics {
  const now = startedAt.toISOString();
  return {
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    batchesTotal: 0,
    batchesSucceeded: 0,
    batchesFailed: 0,
    retryCount: 0,
    httpRequestCount: 0,
    deadLetterCount: 0,
    errors: []
  };
}

function finalizeMetrics(metrics: SiemExportMetrics, startedAt: Date): SiemExportMetrics {
  const endedAt = new Date();
  return {
    ...metrics,
    finishedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime())
  };
}

function defaultCursorPath(outputsDir: string): string {
  return resolve(outputsDir, "audit", "siem-export.cursor.json");
}

function defaultNdjsonPath(outputsDir: string): string {
  return resolve(outputsDir, "audit", "siem-export.jsonl");
}

function defaultDeadLetterPath(outputsDir: string): string {
  return resolve(outputsDir, "audit", "siem-export.dead-letter.jsonl");
}

async function loadCursor(cursorPath: string): Promise<number> {
  try {
    const content = await readFile(cursorPath, "utf-8");
    const parsed = JSON.parse(content) as { lastExportedId?: number };
    return typeof parsed.lastExportedId === "number" ? parsed.lastExportedId : 0;
  } catch {
    return 0;
  }
}

async function saveCursor(cursorPath: string, lastExportedId: number): Promise<void> {
  await mkdir(dirname(cursorPath), { recursive: true });
  await writeFile(
    cursorPath,
    `${JSON.stringify({ lastExportedId, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf-8"
  );
}

export function toSiemPayload(row: AuditLogLike, provider: SiemProvider): Record<string, unknown> {
  if (provider === "splunk-hec") {
    return {
      time: new Date(row.ts).getTime() / 1000,
      source: "sf-ai-audit",
      sourcetype: "sfai:audit",
      event: {
        id: row.id,
        ts: row.ts,
        tenantId: row.tenantId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        payload: row.payloadJson
      }
    };
  }

  if (provider === "datadog-http") {
    return {
      ddsource: "sf-ai",
      service: "salesforce-ai-company",
      ddtags: [`tenant:${row.tenantId ?? "global"}`, `action:${row.action}`].join(","),
      timestamp: row.ts,
      message: JSON.stringify({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        payload: row.payloadJson
      })
    };
  }

  return {
    id: row.id,
    ts: row.ts,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    payload: row.payloadJson
  };
}

async function sendHttpBatch(
  rows: AuditLogLike[],
  options: { provider: Exclude<SiemProvider, "ndjson">; endpoint: string; token?: string }
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (options.provider === "splunk-hec" && options.token) {
    headers.authorization = `Splunk ${options.token}`;
  }
  if (options.provider === "datadog-http" && options.token) {
    headers["dd-api-key"] = options.token;
  }

  const payload = rows.map((row) => toSiemPayload(row, options.provider));
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new SiemHttpError(response.status, response.statusText);
  }
}

async function sendHttpBatchWithRetry(
  rows: AuditLogLike[],
  options: { provider: Exclude<SiemProvider, "ndjson">; endpoint: string; token?: string },
  retryConfig: RetryConfig,
  metrics: SiemExportMetrics
): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    metrics.httpRequestCount += 1;
    try {
      await sendHttpBatch(rows, options);
      return;
    } catch (error) {
      const canRetry = attempt <= retryConfig.maxRetries && isRetryableError(error, retryConfig);
      if (!canRetry) {
        const message = error instanceof Error ? error.message : String(error);
        metrics.errors.push(message);
        throw error;
      }
      metrics.retryCount += 1;
      await sleepMs(backoffDelayMs(attempt, retryConfig));
    }
  }
}

async function appendDeadLetterBatch(
  rows: AuditLogLike[],
  options: SiemExportOptions,
  error: unknown,
  metrics: SiemExportMetrics
): Promise<void> {
  const outputsDir = options.outputsDir?.trim() || getOutputsDir("outputs");
  const deadLetterPath = options.deadLetterFilePath?.trim() || defaultDeadLetterPath(outputsDir);
  const message = error instanceof Error ? error.message : String(error);
  const record = {
    timestamp: new Date().toISOString(),
    provider: options.provider,
    endpoint: options.endpoint,
    reason: message,
    batchSize: rows.length,
    rowIds: rows.map((row) => row.id),
    rows
  };
  await mkdir(dirname(deadLetterPath), { recursive: true });
  await appendFile(deadLetterPath, `${JSON.stringify(record)}\n`, "utf-8");
  metrics.deadLetterCount += rows.length;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export async function exportAuditRowsToSiem(
  rows: AuditLogLike[],
  options: SiemExportOptions
): Promise<SiemExportReport> {
  const startedAt = new Date();
  const metrics = initMetrics(startedAt);
  const outputsDir = options.outputsDir?.trim() || getOutputsDir("outputs");
  const batchSize = Math.max(1, options.batchSize ?? 200);
  const dryRun = options.dryRun ?? false;
  const continueOnBatchError = options.continueOnBatchError ?? false;
  const sortedRows = [...rows].sort((a, b) => a.id - b.id);
  let skippedCount = 0;

  if (sortedRows.length === 0) {
    const finalized = finalizeMetrics(metrics, startedAt);
    return {
      provider: options.provider,
      dryRun,
      exportedCount: 0,
      skippedCount,
      lastExportedId: null,
      target: options.provider === "ndjson" ? defaultNdjsonPath(outputsDir) : options.endpoint ?? "",
      metrics: finalized
    };
  }

  if (options.provider === "ndjson") {
    const target = defaultNdjsonPath(outputsDir);
    metrics.batchesTotal = 1;
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      const lines = sortedRows
        .map((row) => JSON.stringify(toSiemPayload(row, "ndjson")))
        .join("\n");
      await appendFile(target, `${lines}\n`, "utf-8");
    }
    metrics.batchesSucceeded = 1;
    const finalized = finalizeMetrics(metrics, startedAt);

    return {
      provider: "ndjson",
      dryRun,
      exportedCount: sortedRows.length,
      skippedCount,
      lastExportedId: sortedRows[sortedRows.length - 1]?.id ?? null,
      target,
      metrics: finalized
    };
  }

  if (!options.endpoint) {
    throw new Error("endpoint is required for HTTP SIEM providers");
  }

  const batches = chunkRows(sortedRows, batchSize);
  metrics.batchesTotal = batches.length;
  const retryConfig = resolveRetryConfig(options);
  if (!dryRun) {
    for (const batch of batches) {
      try {
        await sendHttpBatchWithRetry(
          batch,
          {
            provider: options.provider,
            endpoint: options.endpoint,
            token: options.token
          },
          retryConfig,
          metrics
        );
        metrics.batchesSucceeded += 1;
      } catch (error) {
        metrics.batchesFailed += 1;
        await appendDeadLetterBatch(batch, { ...options, outputsDir }, error, metrics);
        skippedCount += batch.length;
        if (!continueOnBatchError) {
          throw error;
        }
      }
    }
  } else {
    metrics.batchesSucceeded = batches.length;
  }

  const finalized = finalizeMetrics(metrics, startedAt);

  return {
    provider: options.provider,
    dryRun,
    exportedCount: sortedRows.length - skippedCount,
    skippedCount,
    lastExportedId: sortedRows[sortedRows.length - 1]?.id ?? null,
    target: options.endpoint,
    metrics: finalized
  };
}

export async function exportRecentAuditToSiem(
  deps: {
    list: (options?: {
      limit?: number;
      tenantId?: string;
      actorId?: string;
      action?: string;
      resourceType?: string;
      includeTombstoned?: boolean;
    }) => Promise<AuditLogLike[]>;
  },
  options: SiemExportOptions
): Promise<SiemExportReport> {
  const outputsDir = options.outputsDir?.trim() || getOutputsDir("outputs");
  const cursorPath = options.cursorFilePath ?? defaultCursorPath(outputsDir);
  const cursor = typeof options.startAfterId === "number" ? options.startAfterId : await loadCursor(cursorPath);
  const limit = Math.max(1, options.limit ?? 500);

  const recent = await deps.list({
    limit,
    includeTombstoned: false
  });

  const rows = recent
    .filter((row) => row.id > cursor)
    .sort((a, b) => a.id - b.id);

  const report = await exportAuditRowsToSiem(rows, options);
  if (!report.dryRun && report.lastExportedId !== null) {
    await saveCursor(cursorPath, report.lastExportedId);
  }
  return report;
}

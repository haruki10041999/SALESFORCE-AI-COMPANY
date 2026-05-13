#!/usr/bin/env -S node --import tsx

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import pgvector from "pgvector/pg";
import { createEmbeddingProvider, type VectorEmbeddingProvider } from "../mcp/core/llm/embedding-provider.js";
import { getPrimaryDatabaseUrl } from "../mcp/core/config/runtime-config.js";
import { setTenantSetting, resetTenantSetting } from "../mcp/core/persistence/postgres-tenant-context.js";
import {
  buildEmbeddingMigrationPlan,
  getEmbeddingProfileId,
  type EmbeddingRecordRow
} from "../mcp/core/learning/embedding-migration.js";

interface CliOptions {
  databaseUrl: string;
  batchSize: number;
  limit?: number;
  dryRun: boolean;
  tenantId?: string;
}

interface MigrationSummary {
  databaseUrl: string;
  tenantId?: string;
  targetProfileId: string;
  targetDimension: number;
  scannedRows: number;
  migratedRows: number;
  alreadyCurrentRows: number;
  skippedRows: number;
  batches: number;
  dryRun: boolean;
}

function parseCliArgs(argv: string[]): CliOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      "database-url": { type: "string" },
      "batch-size": { type: "string", default: "100" },
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "tenant-id": { type: "string" }
    },
    allowPositionals: false
  });

  const databaseUrl = parsed.values["database-url"] ?? getPrimaryDatabaseUrl();
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("--database-url or SF_AI_DB_URL_PRIMARY/DATABASE_URL is required");
  }

  const batchSize = Number.parseInt(parsed.values["batch-size"] ?? "100", 10);
  const limitValue = parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined;
  return {
    databaseUrl,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 100,
    limit: Number.isFinite(limitValue ?? Number.NaN) ? limitValue : undefined,
    dryRun: parsed.values["dry-run"] ?? false,
    tenantId: parsed.values["tenant-id"]
  };
}

function toRow(record: {
  id: string;
  tenant_id: string | null;
  text: string;
  tags_json: unknown;
  embedding_model: string;
  embedding_dim: number;
}): EmbeddingRecordRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    text: record.text,
    tags: Array.isArray(record.tags_json)
      ? record.tags_json.filter((tag): tag is string => typeof tag === "string")
      : [],
    embeddingModel: record.embedding_model,
    embeddingDim: record.embedding_dim
  };
}

async function loadCandidates(
  client: import("pg").PoolClient,
  tenantId: string | undefined,
  targetProfileId: string,
  targetDimension: number,
  batchSize: number,
  remainingLimit: number | undefined
): Promise<EmbeddingRecordRow[]> {
  const take = Math.max(1, remainingLimit === undefined ? batchSize : Math.min(batchSize, remainingLimit));
  const params: Array<string | number> = [targetProfileId, targetDimension, take];
  const where = [
    "(embedding_model IS DISTINCT FROM $1 OR embedding_dim IS DISTINCT FROM $2)",
    tenantId ? "tenant_id = $4" : "tenant_id IS NULL"
  ].join(" AND ");
  if (tenantId) {
    params.push(tenantId);
  }

  const result = await client.query<{
    id: string;
    tenant_id: string | null;
    text: string;
    tags_json: unknown;
    embedding_model: string;
    embedding_dim: number;
  }>(
    [
      "SELECT id, tenant_id, text, tags_json, embedding_model, embedding_dim",
      "FROM memory_records",
      `WHERE ${where}`,
      "ORDER BY updated_at ASC, id ASC",
      "LIMIT $3"
    ].join("\n"),
    params
  );

  return result.rows.map(toRow);
}

async function migrateBatch(
  client: import("pg").PoolClient,
  provider: VectorEmbeddingProvider,
  tenantId: string | undefined,
  targetProfileId: string,
  targetDimension: number,
  batchSize: number,
  summary: MigrationSummary,
  remainingLimit: number | undefined
): Promise<number> {
  const candidates = await loadCandidates(client, tenantId, targetProfileId, targetDimension, batchSize, remainingLimit);
  summary.scannedRows += candidates.length;
  if (candidates.length === 0) {
    return 0;
  }

  const plan = buildEmbeddingMigrationPlan(candidates, {
    name: provider.name,
    dimension: targetDimension,
    profileId: targetProfileId
  });
  summary.alreadyCurrentRows += plan.rowsAlreadyCurrent;

  if (summary.dryRun) {
    summary.skippedRows += candidates.length;
    return candidates.length;
  }

  const texts = candidates.map((row) => `${row.text} ${(row.tags ?? []).join(" ")}`);
  const embeddings = await provider.embedBatch(texts);

  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const embedding = embeddings[index] ?? [];
    await client.query(
      [
        "UPDATE memory_records",
        "SET embedding = $2::vector,",
        "    embedding_model = $3,",
        "    embedding_dim = $4,",
        "    embedding_norm = $5,",
        "    updated_at = NOW()",
        "WHERE id = $1"
      ].join("\n"),
      [row.id, pgvector.toSql(embedding), targetProfileId, targetDimension, true]
    );
    summary.migratedRows += 1;
  }

  return candidates.length;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const provider = createEmbeddingProvider();
  const probeVector = await provider.embed("embedding migration probe");
  const targetDimension = provider.dimension > 0 ? provider.dimension : probeVector.length;
  const targetProfileId = getEmbeddingProfileId({
    name: provider.name,
    dimension: targetDimension,
    profileId: provider.profileId
  });

  const pool = new Pool({ connectionString: options.databaseUrl });
  const summary: MigrationSummary = {
    databaseUrl: options.databaseUrl,
    tenantId: options.tenantId,
    targetProfileId,
    targetDimension,
    scannedRows: 0,
    migratedRows: 0,
    alreadyCurrentRows: 0,
    skippedRows: 0,
    batches: 0,
    dryRun: options.dryRun
  };

  try {
    const client = await pool.connect();
    try {
      await setTenantSetting(client, options.tenantId);
      let remainingLimit = options.limit;
      while (remainingLimit === undefined || remainingLimit > 0) {
        const processed = await migrateBatch(
          client,
          provider,
          options.tenantId,
          targetProfileId,
          targetDimension,
          options.batchSize,
          summary,
          remainingLimit
        );
        if (processed === 0) {
          break;
        }
        summary.batches += 1;
        if (remainingLimit !== undefined) {
          remainingLimit -= processed;
        }
      }
    } finally {
      await resetTenantSetting(client);
      client.release();
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`migrate-embeddings failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

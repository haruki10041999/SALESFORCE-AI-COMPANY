import { createHash } from "node:crypto";
import { Pool } from "pg";
import { getOrCreatePgPool, releasePgPoolKey } from "../../core/persistence/pg-pool-registry.js";
import type {
  LlmCacheEntry,
  LlmCacheLookupInput,
  LlmCacheStoreInput,
  LlmCacheStorePort
} from "../../core/ports/llm-cache-port.js";

interface LlmCacheRow {
  cache_key: string;
  prompt_hash: string;
  adapter: string;
  version: string;
  model: string | null;
  params_hash: string;
  output_text: string;
  usage_json: unknown;
  metadata_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toEntry(row: LlmCacheRow): LlmCacheEntry {
  return {
    cacheKey: row.cache_key,
    promptHash: row.prompt_hash,
    adapter: row.adapter,
    version: row.version,
    model: row.model ?? undefined,
    paramsHash: row.params_hash,
    outputText: row.output_text,
    usage: (typeof row.usage_json === "string" ? JSON.parse(row.usage_json) : row.usage_json ?? undefined) as
      | { inputTokens?: number; outputTokens?: number }
      | undefined,
    metadata: (typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json ?? undefined) as
      | Record<string, unknown>
      | undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildLlmCacheKey(input: {
  prompt: string;
  adapter: string;
  version: string;
  params: Record<string, unknown>;
}): { cacheKey: string; promptHash: string; paramsHash: string } {
  const promptHash = sha256Hex(input.prompt);
  const paramsHash = sha256Hex(JSON.stringify(input.params));
  const cacheKey = sha256Hex(`${promptHash}:${input.adapter}:${input.version}:${paramsHash}`);
  return { cacheKey, promptHash, paramsHash };
}

export class PostgresLlmCacheStore implements LlmCacheStorePort {
  private readonly poolKey: string;
  private readonly pool: Pool;
  private schemaReady = false;

  constructor(databaseUrl: string) {
    if (!databaseUrl?.trim()) {
      throw new Error("DATABASE_URL is required for PostgresLlmCacheStore");
    }
    this.poolKey = `llm-cache:${databaseUrl.trim()}`;
    this.pool = getOrCreatePgPool(this.poolKey, databaseUrl.trim());
  }

  public async get(input: LlmCacheLookupInput): Promise<LlmCacheEntry | null> {
    await this.ensureSchema();
    const result = await this.pool.query<LlmCacheRow>(
      [
        "SELECT cache_key, prompt_hash, adapter, version, model, params_hash, output_text, usage_json, metadata_json, created_at, updated_at",
        "FROM llm_cache_entries",
        "WHERE cache_key = $1"
      ].join("\n"),
      [input.cacheKey]
    );
    return result.rowCount ? toEntry(result.rows[0]!) : null;
  }

  public async set(input: LlmCacheStoreInput): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      [
        "INSERT INTO llm_cache_entries(",
        "  cache_key, prompt_hash, adapter, version, model, params_hash, output_text, usage_json, metadata_json",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)",
        "ON CONFLICT (cache_key)",
        "DO UPDATE SET",
        "  output_text = EXCLUDED.output_text,",
        "  usage_json = EXCLUDED.usage_json,",
        "  metadata_json = EXCLUDED.metadata_json,",
        "  updated_at = NOW()"
      ].join("\n"),
      [
        input.cacheKey,
        input.promptHash,
        input.adapter,
        input.version,
        input.model ?? null,
        input.paramsHash,
        input.outputText,
        JSON.stringify(input.usage ?? {}),
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  public async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    await this.pool.query(
      [
        "CREATE TABLE IF NOT EXISTS llm_cache_entries(",
        "  cache_key text PRIMARY KEY,",
        "  prompt_hash text NOT NULL,",
        "  adapter text NOT NULL,",
        "  version text NOT NULL,",
        "  model text,",
        "  params_hash text NOT NULL,",
        "  output_text text NOT NULL,",
        "  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  created_at timestamptz NOT NULL DEFAULT NOW(),",
        "  updated_at timestamptz NOT NULL DEFAULT NOW()",
        ")"
      ].join("\n")
    );

    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS idx_llm_cache_entries_adapter_version ON llm_cache_entries(adapter, version, updated_at DESC)"
    );

    this.schemaReady = true;
  }
}

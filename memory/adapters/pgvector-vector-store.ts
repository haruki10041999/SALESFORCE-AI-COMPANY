import pgvector from "pgvector/pg";
import { Pool, type PoolClient } from "pg";
import { createEmbeddingProvider, type VectorEmbeddingProvider } from "../../mcp/core/llm/embedding-provider.js";
import { getDefaultLangChainEmbeddingProvider } from "../../mcp/core/llm/langchain-embedding.js";
import { circuitBreakerRegistry } from "../../mcp/core/reliability/circuit-breaker.js";
import { bulkheadRegistry, DEFAULT_PGVECTOR_CONCURRENCY } from "../../mcp/core/reliability/bulkhead.js";
import { currentTenantId } from "../../mcp/core/identity/tenant-context.js";
import { ensureTenantRlsPolicy, resetTenantSetting, setTenantSetting } from "../../mcp/core/persistence/postgres-tenant-context.js";
import { getOrCreatePgPool, releasePgPoolKey } from "../../mcp/core/persistence/pg-pool-registry.js";
import { classifyVectorTier } from "../../mcp/core/memory/vector-tier.js";
import type { EmbeddingProvider, MemoryRecord, VectorSearchOptions, VectorStoreAdapter } from "../vector-store-adapter.js";
import type { VectorTier } from "../../mcp/core/ports/memory-service.js";

function toIsoNow(): string {
  return new Date().toISOString();
}

function normalizeVectorDimension(vector: number[], dimension = 768): number[] {
  if (vector.length === dimension) {
    return vector;
  }
  if (vector.length > dimension) {
    return vector.slice(0, dimension);
  }
  const out = vector.slice();
  while (out.length < dimension) {
    out.push(0);
  }
  return out;
}

export class PgvectorVectorStoreAdapter implements VectorStoreAdapter {
  private readonly pool: Pool;
  private readonly poolKey: string;
  private embeddingProvider: VectorEmbeddingProvider;
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly circuitBreaker = circuitBreakerRegistry.get("pgvector", {
    failureRateThreshold: 0.5,
    minCallsInWindow: 5,
    cooldownMs: 15_000,
    windowSize: 20,
    halfOpenSuccessThreshold: 1
  });
  private readonly bulkhead = bulkheadRegistry.get("pgvector", {
    concurrency: DEFAULT_PGVECTOR_CONCURRENCY,
    maxQueue: 100
  });
  private schemaReady = false;
  private schemaPromise: Promise<void> | null = null;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl || databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required when SF_AI_VECTOR_BACKEND=pgvector");
    }

    const normalizedUrl = databaseUrl.trim();
    this.poolKey = `pgvector-vector-store:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.pool = getOrCreatePgPool(this.poolKey, normalizedUrl);
    const embeddingClient = (process.env.SF_AI_LLM_CLIENT ?? "native").toLowerCase();
    this.embeddingProvider = embeddingClient === "langchain"
      ? getDefaultLangChainEmbeddingProvider()
      : createEmbeddingProvider({
        env: {
          ...process.env,
          EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER ?? "ngram"
        }
      });
  }

  public configureStorageForTest(_filePath: string): void {
    // no-op for DB backend
  }

  public configureLimitsForTest(_limits: { maxRecords?: number; maxBytes?: number }): void {
    // no-op for DB backend
  }

  public configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
    const providerProfileId = (provider as { profileId?: string }).profileId;
    const adapterProvider: VectorEmbeddingProvider = {
      name: "ngram",
      profileId: providerProfileId ?? (typeof provider.toString === "function" ? provider.toString() : undefined) ?? "ngram:test",
      dimension: 768,
      async embed(text: string): Promise<number[]> {
        const tokens = provider.search([{ id: text, text, tags: [] }], text);
        const base = tokens.length > 0 ? 1 : 0;
        return normalizeVectorDimension([base], 768);
      },
      async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
        return Promise.all(texts.map((text) => this.embed(text)));
      }
    };
    this.embeddingProvider = adapterProvider;
  }

  public clearRecords(): void {
    const clearPromise = this.withClient(async (client) => {
      await this.ensureSchema();
      await client.query("TRUNCATE TABLE memory_records");
    });
    this.trackWrite(clearPromise);
  }

  public addRecord(record: MemoryRecord): void {
    const writePromise = this.withClient(async (client) => {
      await this.ensureSchema();
      const tenantId = currentTenantId() ?? null;
      const profileId = this.embeddingProvider.profileId ?? this.embeddingProvider.name;
      const tier = record.tier ?? classifyVectorTier({ text: record.text, tags: record.tags });
      const rawEmbedding = await this.embeddingProvider.embed(`${record.text} ${(record.tags ?? []).join(" ")}`);
      const dim = this.embeddingProvider.dimension > 0 ? this.embeddingProvider.dimension : rawEmbedding.length;
      const embedding = normalizeVectorDimension(rawEmbedding, dim);
      await client.query(
        [
          "INSERT INTO memory_records(id, tenant_id, text, tags_json, embedding, updated_at, embedding_model, embedding_dim, embedding_norm, vector_tier)",
          "VALUES ($1, $2, $3, $4::jsonb, $5::vector, $6::timestamptz, $7, $8, $9, $10)",
          "ON CONFLICT(id) DO UPDATE SET",
          "  tenant_id = EXCLUDED.tenant_id,",
          "  text = EXCLUDED.text,",
          "  tags_json = EXCLUDED.tags_json,",
          "  embedding = EXCLUDED.embedding,",
          "  updated_at = EXCLUDED.updated_at,",
          "  embedding_model = EXCLUDED.embedding_model,",
          "  embedding_dim = EXCLUDED.embedding_dim,",
          "  embedding_norm = EXCLUDED.embedding_norm,",
          "  vector_tier = EXCLUDED.vector_tier"
        ].join("\n"),
        [
          record.id,
          tenantId,
          record.text,
          JSON.stringify(record.tags ?? []),
          pgvector.toSql(embedding),
          toIsoNow(),
          profileId,
          dim,
          true,
          tier
        ]
      );
    });
    this.trackWrite(writePromise);
  }

  public searchByKeyword(_query: string): MemoryRecord[] {
    return [];
  }

  public async searchByKeywordAsync(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<Array<MemoryRecord & { score?: number }>> {
    if (query.trim().length === 0) {
      return [];
    }

    await this.flushPendingWrites();
    const tenantId = currentTenantId();
    const modelName = this.embeddingProvider.profileId ?? this.embeddingProvider.name;
    const rawQueryVector = await this.embeddingProvider.embed(query);
    const dim = this.embeddingProvider.dimension > 0 ? this.embeddingProvider.dimension : rawQueryVector.length;
    const queryVector = normalizeVectorDimension(rawQueryVector, dim);
    const limit = Math.max(1, options.limit ?? 10);
    const minScore = options.minScore ?? -1;

    return this.withClient(async (client) => {
      await this.ensureSchema();
      const result = await client.query<{
        id: string;
        text: string;
        tags_json: unknown;
        vector_tier: string | null;
        score: number;
      }>(
        [
          "SELECT id, text, tags_json, vector_tier, 1 - (embedding <=> $1::vector) AS score",
          "FROM memory_records",
          tenantId
            ? "WHERE embedding_model = $3 AND embedding_dim = $4 AND tenant_id = $5"
            : "WHERE embedding_model = $3 AND embedding_dim = $4 AND tenant_id IS NULL",
          "ORDER BY embedding <=> $1::vector ASC",
          "LIMIT $2"
        ].join("\n"),
        tenantId
          ? [pgvector.toSql(queryVector), limit, modelName, dim, tenantId]
          : [pgvector.toSql(queryVector), limit, modelName, dim]
      );

      return result.rows
        .map((row) => {
          const tags = Array.isArray(row.tags_json)
            ? row.tags_json.filter((tag): tag is string => typeof tag === "string")
            : [];
          const tier = this.isVectorTier(row.vector_tier) ? row.vector_tier : undefined;
          return {
            id: row.id,
            text: row.text,
            tags,
            tier,
            score: typeof row.score === "number" ? row.score : Number(row.score)
          };
        })
        .filter((row) => Number.isFinite(row.score) && row.score >= minScore);
    });
  }

  public resetBackendForTest(): void {
    const closePromise = releasePgPoolKey(this.poolKey)
      .then(() => {
        this.schemaReady = false;
        this.schemaPromise = null;
      })
      .catch(() => undefined);
    this.trackWrite(closePromise);
  }

  public async flushPendingWrites(): Promise<void> {
    if (this.pendingWrites.size === 0) {
      return;
    }
    await Promise.all([...this.pendingWrites]);
  }

  private trackWrite(promise: Promise<void>): void {
    this.pendingWrites.add(promise);
    promise.finally(() => this.pendingWrites.delete(promise)).catch(() => undefined);
  }

  private isVectorTier(value: string | null): value is VectorTier {
    return value === "hot" || value === "warm" || value === "cold";
  }

  private async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const tenantId = currentTenantId();
    return this.bulkhead.execute(async () => {
      return this.circuitBreaker.execute(async () => {
        const client = await this.pool.connect();
        try {
          await setTenantSetting(client, tenantId);
          return await work(client);
        } finally {
          await resetTenantSetting(client);
          client.release();
        }
      });
    });
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        const client = await this.pool.connect();
        try {
          await client.query("CREATE EXTENSION IF NOT EXISTS vector");
          await client.query(
            [
              "CREATE TABLE IF NOT EXISTS memory_records(",
              "  id text PRIMARY KEY,",
              "  tenant_id text,",
              "  text text NOT NULL,",
              "  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
              "  embedding vector(768) NOT NULL,",
              "  updated_at timestamptz NOT NULL DEFAULT now(),",
              "  embedding_model text NOT NULL DEFAULT 'legacy-768',",
              "  embedding_dim integer NOT NULL DEFAULT 768,",
              "  embedding_norm boolean NOT NULL DEFAULT true",
              ")"
            ].join("\n")
          );
          // Back-fill columns for pre-existing databases that lack the metadata columns
          await client.query("ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS tenant_id text");
          await client.query("ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'legacy-768'");
          await client.query("ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS embedding_dim integer NOT NULL DEFAULT 768");
          await client.query("ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS embedding_norm boolean NOT NULL DEFAULT true");
          await client.query("ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS vector_tier text NOT NULL DEFAULT 'warm'");
          await client.query(
            "CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_cosine ON memory_records USING hnsw (embedding vector_cosine_ops)"
          );
          await client.query(
            "CREATE INDEX IF NOT EXISTS idx_memory_records_model_dim ON memory_records (embedding_model, embedding_dim)"
          );
          await client.query(
            "CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_model_dim ON memory_records (tenant_id, embedding_model, embedding_dim)"
          );
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_records_vector_tier ON memory_records (vector_tier)");
          await ensureTenantRlsPolicy(client, "memory_records", "memory_records_tenant_isolation");
          this.schemaReady = true;
        } finally {
          client.release();
        }
      })();
    }

    await this.schemaPromise;
  }
}

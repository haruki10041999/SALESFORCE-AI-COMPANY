import pgvector from "pgvector/pg";
import { Pool, type PoolClient } from "pg";
import { createEmbeddingProvider, type VectorEmbeddingProvider } from "../../mcp/core/llm/embedding-provider.js";
import { getDefaultLangChainEmbeddingProvider } from "../../mcp/core/llm/langchain-embedding.js";
import type { EmbeddingProvider, MemoryRecord, VectorSearchOptions, VectorStoreAdapter } from "../vector-store-adapter.js";

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
  private embeddingProvider: VectorEmbeddingProvider;
  private readonly pendingWrites = new Set<Promise<void>>();
  private schemaReady = false;
  private schemaPromise: Promise<void> | null = null;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl || databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required when SF_AI_VECTOR_BACKEND=pgvector");
    }

    this.pool = new Pool({ connectionString: databaseUrl });
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
    const adapterProvider: VectorEmbeddingProvider = {
      name: "ngram",
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
      const embedding = normalizeVectorDimension(
        await this.embeddingProvider.embed(`${record.text} ${(record.tags ?? []).join(" ")}`),
        768
      );
      await client.query(
        [
          "INSERT INTO memory_records(id, text, tags_json, embedding, updated_at)",
          "VALUES ($1, $2, $3::jsonb, $4::vector, $5::timestamptz)",
          "ON CONFLICT(id) DO UPDATE SET",
          "  text = EXCLUDED.text,",
          "  tags_json = EXCLUDED.tags_json,",
          "  embedding = EXCLUDED.embedding,",
          "  updated_at = EXCLUDED.updated_at"
        ].join("\n"),
        [
          record.id,
          record.text,
          JSON.stringify(record.tags ?? []),
          pgvector.toSql(embedding),
          toIsoNow()
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
    const queryVector = normalizeVectorDimension(await this.embeddingProvider.embed(query), 768);
    const limit = Math.max(1, options.limit ?? 10);
    const minScore = options.minScore ?? -1;

    return this.withClient(async (client) => {
      await this.ensureSchema();
      const result = await client.query<{
        id: string;
        text: string;
        tags_json: unknown;
        score: number;
      }>(
        [
          "SELECT id, text, tags_json, 1 - (embedding <=> $1::vector) AS score",
          "FROM memory_records",
          "ORDER BY embedding <=> $1::vector ASC",
          "LIMIT $2"
        ].join("\n"),
        [pgvector.toSql(queryVector), limit]
      );

      return result.rows
        .map((row) => {
          const tags = Array.isArray(row.tags_json)
            ? row.tags_json.filter((tag): tag is string => typeof tag === "string")
            : [];
          return {
            id: row.id,
            text: row.text,
            tags,
            score: typeof row.score === "number" ? row.score : Number(row.score)
          };
        })
        .filter((row) => Number.isFinite(row.score) && row.score >= minScore);
    });
  }

  public resetBackendForTest(): void {
    const closePromise = this.pool.end().then(() => undefined).catch(() => undefined);
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

  private async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
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
              "  text text NOT NULL,",
              "  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,",
              "  embedding vector(768) NOT NULL,",
              "  updated_at timestamptz NOT NULL DEFAULT now()",
              ")"
            ].join("\n")
          );
          await client.query(
            "CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_cosine ON memory_records USING hnsw (embedding vector_cosine_ops)"
          );
          this.schemaReady = true;
        } finally {
          client.release();
        }
      })();
    }

    await this.schemaPromise;
  }
}

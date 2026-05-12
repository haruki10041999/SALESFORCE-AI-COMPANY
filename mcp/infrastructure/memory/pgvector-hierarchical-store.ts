import type {
  HierarchicalIngestInput,
  HierarchicalIngestResult,
  HierarchicalSearchInput,
  HierarchicalSearchOutput,
  HierarchicalStore
} from "../../core/ports/memory-service.js";
import pgvector from "pgvector/pg";
import { Pool, type PoolClient } from "pg";
import type { MemoryChunker } from "../../../memory/chunker.js";
import { createEmbeddingProvider, type VectorEmbeddingProvider } from "../../core/llm/embedding-provider.js";
import { getOrCreatePgPool, releasePgPoolKey } from "../../core/persistence/pg-pool-registry.js";
import { currentTenantId } from "../../core/identity/tenant-context.js";
import { resetTenantSetting, setTenantSetting } from "../../core/persistence/postgres-tenant-context.js";

export interface PgvectorHierarchicalStoreOptions {
  chunker: MemoryChunker;
  databaseUrl?: string;
  embeddingProvider?: VectorEmbeddingProvider;
}

export class PgvectorHierarchicalStore implements HierarchicalStore {
  private readonly chunker: MemoryChunker;
  private readonly pool: Pool;
  private readonly poolKey: string;
  private readonly embeddingProvider: VectorEmbeddingProvider;
  private schemaReady = false;
  private schemaPromise: Promise<void> | null = null;

  constructor(options: PgvectorHierarchicalStoreOptions) {
    this.chunker = options.chunker;
    const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl || databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required for PgvectorHierarchicalStore");
    }
    this.poolKey = `pgvector-hierarchical-store:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.pool = getOrCreatePgPool(this.poolKey, databaseUrl.trim());
    this.embeddingProvider = options.embeddingProvider ?? createEmbeddingProvider({ env: process.env });
  }

  async ingest(input: HierarchicalIngestInput): Promise<HierarchicalIngestResult> {
    const chunked = (input.isMarkdown ?? true)
      ? this.chunker.chunkMarkdown(input.content, input.title)
      : this.chunker.chunkPlainText(input.content, input.title);

    let chunkCount = 0;
    const tenantId = currentTenantId() ?? "default";

    await this.withClient(async (client) => {
      await this.ensureSchema();
      await client.query("BEGIN");
      try {
        const docResult = await client.query<{ id: number }>(
          [
            "INSERT INTO memory_documents(external_id, tenant_id, title, source, estimated_tokens, updated_at)",
            "VALUES ($1, $2, $3, $4, $5, NOW())",
            "ON CONFLICT(external_id) DO UPDATE SET",
            "  tenant_id = EXCLUDED.tenant_id,",
            "  title = EXCLUDED.title,",
            "  estimated_tokens = EXCLUDED.estimated_tokens,",
            "  updated_at = NOW()",
            "RETURNING id"
          ].join("\n"),
          [input.id, tenantId, input.title, input.isMarkdown === false ? "text" : "markdown", chunked.estimatedTokens]
        );
        const documentId = docResult.rows[0]?.id;
        if (!documentId) {
          throw new Error("failed to create or update memory_documents record");
        }

        await client.query("DELETE FROM memory_sections WHERE document_id = $1", [documentId]);

        for (const [sectionIndex, section] of chunked.sections.entries()) {
          const sectionSummary = this.buildSectionSummary(section.content);
          const sectionResult = await client.query<{ id: number }>(
            [
              "INSERT INTO memory_sections(document_id, section_index, heading, level, content, summary, estimated_tokens)",
              "VALUES ($1, $2, $3, $4, $5, $6, $7)",
              "RETURNING id"
            ].join("\n"),
            [
              documentId,
              sectionIndex,
              section.heading,
              section.level,
              section.content,
              sectionSummary,
              this.estimateTokens(section.content)
            ]
          );
          const sectionId = sectionResult.rows[0]?.id;
          if (!sectionId) {
            throw new Error("failed to create memory_sections record");
          }

          for (const [chunkIndex, chunk] of section.chunks.entries()) {
            const embedding = await this.embedText(chunk.text);
            await client.query(
              [
                "INSERT INTO memory_chunks(section_id, chunk_index, text, start_token, end_token, embedding_model, embedding_dim, embedding)",
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)"
              ].join("\n"),
              [
                sectionId,
                chunkIndex,
                chunk.text,
                chunk.startToken,
                chunk.endToken,
                this.embeddingProvider.name,
                this.embeddingProvider.dimension,
                pgvector.toSql(embedding)
              ]
            );
            chunkCount += 1;
          }
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    return {
      documentId: input.id,
      sections: chunked.sections.length,
      chunks: chunkCount
    };
  }

  async search(input: HierarchicalSearchInput): Promise<HierarchicalSearchOutput[]> {
    const limit = Math.max(1, input.limit ?? 5);
    const minScore = input.minScore ?? 0.5;
    const expandTo = input.expandTo ?? "chunk";
    const tenantId = currentTenantId() ?? "default";
    const queryEmbedding = await this.embedText(input.query);

    type ChunkRow = {
      section_id: number;
      section_index: number;
      heading: string | null;
      summary: string | null;
      content: string;
      chunk_index: number;
      chunk_text: string;
      prev_text: string | null;
      next_text: string | null;
      document_external_id: string;
      document_title: string;
      score: number;
    };

    const rows = await this.withClient(async (client) => {
      await this.ensureSchema();
      const queryResult = await client.query<ChunkRow>(
        [
          "SELECT",
          "  ms.id AS section_id,",
          "  ms.section_index,",
          "  ms.heading,",
          "  ms.summary,",
          "  ms.content,",
          "  mc.chunk_index,",
          "  mc.text AS chunk_text,",
          "  LAG(mc.text) OVER (PARTITION BY mc.section_id ORDER BY mc.chunk_index) AS prev_text,",
          "  LEAD(mc.text) OVER (PARTITION BY mc.section_id ORDER BY mc.chunk_index) AS next_text,",
          "  md.external_id AS document_external_id,",
          "  md.title AS document_title,",
          "  1 - (mc.embedding <=> $1::vector) AS score",
          "FROM memory_chunks mc",
          "JOIN memory_sections ms ON ms.id = mc.section_id",
          "JOIN memory_documents md ON md.id = ms.document_id",
          "WHERE md.tenant_id = $2",
          "  AND mc.embedding IS NOT NULL",
          "  AND 1 - (mc.embedding <=> $1::vector) >= $3",
          "ORDER BY mc.embedding <=> $1::vector ASC",
          "LIMIT $4"
        ].join("\n"),
        [pgvector.toSql(queryEmbedding), tenantId, minScore, Math.max(limit * 4, limit)]
      );
      return queryResult.rows;
    });

    const chunkResults: HierarchicalSearchOutput[] = rows.map((row) => ({
      type: "chunk",
      sectionIndex: row.section_index,
      chunkIndex: row.chunk_index,
      score: Number(row.score),
      text: row.chunk_text,
      documentId: row.document_external_id,
      summary: row.document_title,
      ...(input.withContext
        ? {
          context: {
            sectionSummary: row.summary ?? undefined,
            prevChunk: row.prev_text ?? undefined,
            nextChunk: row.next_text ?? undefined
          }
        }
        : {})
    }));

    if (expandTo === "chunk") {
      return chunkResults.slice(0, limit);
    }
    if (expandTo === "section") {
      return this.expandToSections(chunkResults, rows).slice(0, limit);
    }
    return this.expandToDocuments(chunkResults, rows).slice(0, limit);
  }

  async close(): Promise<void> {
    await releasePgPoolKey(this.poolKey);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        await this.withClient(async (client) => {
          await client.query("CREATE EXTENSION IF NOT EXISTS vector");
          await client.query(
            [
              "CREATE TABLE IF NOT EXISTS memory_documents (",
              "  id BIGSERIAL PRIMARY KEY,",
              "  external_id TEXT NOT NULL UNIQUE,",
              "  tenant_id TEXT NOT NULL DEFAULT 'default',",
              "  title TEXT NOT NULL,",
              "  source TEXT,",
              "  estimated_tokens INTEGER DEFAULT 0,",
              "  created_at TIMESTAMPTZ DEFAULT NOW(),",
              "  updated_at TIMESTAMPTZ DEFAULT NOW(),",
              "  archived_at TIMESTAMPTZ",
              ")"
            ].join("\n")
          );
          await client.query(
            [
              "CREATE TABLE IF NOT EXISTS memory_sections (",
              "  id BIGSERIAL PRIMARY KEY,",
              "  document_id BIGINT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,",
              "  section_index INTEGER NOT NULL,",
              "  heading TEXT,",
              "  level INTEGER NOT NULL,",
              "  content TEXT NOT NULL,",
              "  summary TEXT,",
              "  estimated_tokens INTEGER DEFAULT 0,",
              "  created_at TIMESTAMPTZ DEFAULT NOW()",
              ")"
            ].join("\n")
          );
          await client.query(
            [
              "CREATE TABLE IF NOT EXISTS memory_chunks (",
              "  id BIGSERIAL PRIMARY KEY,",
              "  section_id BIGINT NOT NULL REFERENCES memory_sections(id) ON DELETE CASCADE,",
              "  chunk_index INTEGER NOT NULL,",
              "  text TEXT NOT NULL,",
              "  start_token INTEGER NOT NULL,",
              "  end_token INTEGER NOT NULL,",
              "  embedding_model TEXT,",
              "  embedding_dim INTEGER,",
              "  created_at TIMESTAMPTZ DEFAULT NOW()",
              ")"
            ].join("\n")
          );
          await client.query("ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS embedding vector(768)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_documents_external_id ON memory_documents(external_id)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_documents_tenant ON memory_documents(tenant_id)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_sections_document_id ON memory_sections(document_id)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_sections_index ON memory_sections(document_id, section_index)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_chunks_section_id ON memory_chunks(section_id)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_chunks_index ON memory_chunks(section_id, chunk_index)");
          await client.query("CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_cosine ON memory_chunks USING hnsw (embedding vector_cosine_ops)");
        });
        this.schemaReady = true;
      })();
    }
    await this.schemaPromise;
  }

  private async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await setTenantSetting(client, currentTenantId() ?? undefined);
      return await work(client);
    } finally {
      await resetTenantSetting(client);
      client.release();
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private buildSectionSummary(content: string): string {
    const words = content.split(/\s+/).slice(0, 50);
    return words.join(" ") + (words.length < 50 ? "" : "...");
  }

  private async embedText(text: string): Promise<number[]> {
    const targetDim = 768;
    const embedded = await this.embeddingProvider.embed(text);
    if (embedded.length === targetDim) {
      return embedded;
    }
    if (embedded.length > targetDim) {
      return embedded.slice(0, targetDim);
    }
    return [...embedded, ...Array(targetDim - embedded.length).fill(0)];
  }

  private expandToSections(
    _chunks: HierarchicalSearchOutput[],
    rows: Array<{ section_id: number; section_index: number; content: string; summary: string | null; document_external_id: string; score: number }>
  ): HierarchicalSearchOutput[] {
    const sectionMap = new Map<string, HierarchicalSearchOutput>();
    for (const row of rows) {
      const key = `${row.document_external_id}:${row.section_id}`;
      if (sectionMap.has(key)) {
        continue;
      }
      sectionMap.set(key, {
        type: "section",
        sectionIndex: row.section_index,
        score: Number(row.score),
        text: row.content,
        documentId: row.document_external_id,
        summary: row.summary ?? undefined
      });
    }
    return [...sectionMap.values()];
  }

  private expandToDocuments(
    _chunks: HierarchicalSearchOutput[],
    rows: Array<{ document_external_id: string; document_title: string; score: number }>
  ): HierarchicalSearchOutput[] {
    const docs = new Map<string, HierarchicalSearchOutput>();
    for (const row of rows) {
      if (docs.has(row.document_external_id)) {
        continue;
      }
      docs.set(row.document_external_id, {
        type: "document",
        sectionIndex: -1,
        score: Number(row.score),
        text: row.document_title,
        documentId: row.document_external_id,
        summary: row.document_title
      });
    }
    return [...docs.values()];
  }
}

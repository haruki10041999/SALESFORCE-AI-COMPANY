/**
 * QdrantVectorStoreAdapter — bridges QdrantVectorStore to the legacy VectorStoreAdapter interface.
 * Used when SF_AI_VECTOR_BACKEND=qdrant.
 */

import { QdrantVectorStore } from "../../mcp/core/memory/qdrant-vector-store.js";
import type { EmbeddingProvider, MemoryRecord, VectorSearchOptions, VectorStoreAdapter } from "../vector-store-adapter.js";

export class QdrantVectorStoreAdapter implements VectorStoreAdapter {
  private store: QdrantVectorStore;

  constructor() {
    this.store = new QdrantVectorStore();
  }

  // ------------------------------------------------------------------
  // Test-only configuration hooks (no-ops for Qdrant in tests)
  // ------------------------------------------------------------------

  configureStorageForTest(_filePath: string): void {
    // Qdrant does not use a local file path; ignored in test configuration
  }

  configureLimitsForTest(_limits: { maxRecords?: number; maxBytes?: number }): void {
    // Qdrant has its own storage limits; test-level limits are not applied
  }

  configureEmbeddingProviderForTest(_provider: EmbeddingProvider): void {
    // Embedding injection not supported for Qdrant adapter
  }

  resetBackendForTest(): void {
    this.store = new QdrantVectorStore();
  }

  // ------------------------------------------------------------------
  // VectorStoreAdapter implementation
  // ------------------------------------------------------------------

  clearRecords(): void {
    // Fire-and-forget async clear
    this.store.clear().catch(() => { /* swallow in sync context */ });
  }

  addRecord(record: MemoryRecord): void {
    // Fire-and-forget async upsert
    this.store
      .upsert({
        id: record.id,
        text: record.text,
        tier: record.tier,
        metadata: { tags: record.tags },
      })
      .catch(() => { /* swallow in sync context */ });
  }

  searchByKeyword(query: string): MemoryRecord[] {
    // Synchronous search is not natively supported; return empty for now.
    // Callers should prefer searchByKeywordAsync.
    void query;
    return [];
  }

  async searchByKeywordAsync(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<Array<MemoryRecord & { score?: number }>> {
    const results = await this.store.query(query, {
      limit: options.limit,
      minScore: options.minScore,
    });

    return results.map((r) => ({
      id: r.record.id,
      text: r.record.text,
      tags: (r.record.metadata?.tags as string[]) ?? [],
      tier: r.record.tier,
      score: r.score,
    }));
  }
}

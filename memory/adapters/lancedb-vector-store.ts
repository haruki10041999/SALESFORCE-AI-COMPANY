/**
 * LanceDBVectorStoreAdapter — bridges LanceDBVectorStore to the legacy VectorStoreAdapter interface.
 * Used when SF_AI_VECTOR_BACKEND=lancedb.
 */

import { LanceDBVectorStore } from "../../mcp/core/memory/lancedb-vector-store.js";
import type { EmbeddingProvider, MemoryRecord, VectorSearchOptions, VectorStoreAdapter } from "../vector-store-adapter.js";

export class LanceDBVectorStoreAdapter implements VectorStoreAdapter {
  private store: LanceDBVectorStore;

  constructor() {
    this.store = new LanceDBVectorStore();
  }

  // ------------------------------------------------------------------
  // Test-only configuration hooks
  // ------------------------------------------------------------------

  configureStorageForTest(filePath: string): void {
    // Reinitialise the store with the given path as the LanceDB URI
    this.store = new LanceDBVectorStore({ uri: filePath });
  }

  configureLimitsForTest(_limits: { maxRecords?: number; maxBytes?: number }): void {
    // LanceDB does not apply in-process record limits; ignored
  }

  configureEmbeddingProviderForTest(_provider: EmbeddingProvider): void {
    // Embedding injection not supported for LanceDB adapter
  }

  resetBackendForTest(): void {
    this.store = new LanceDBVectorStore();
  }

  // ------------------------------------------------------------------
  // VectorStoreAdapter implementation
  // ------------------------------------------------------------------

  clearRecords(): void {
    this.store.clear().catch(() => { /* swallow in sync context */ });
  }

  addRecord(record: MemoryRecord): void {
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
    // Synchronous search not natively supported; callers should use searchByKeywordAsync.
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

export type MemoryRecord = {
  id: string;
  text: string;
  tags: string[];
};

export interface EmbeddingProvider {
  search(records: MemoryRecord[], query: string): MemoryRecord[];
}

export interface VectorSearchOptions {
  limit?: number;
  minScore?: number;
}

export interface VectorStoreAdapter {
  configureStorageForTest(filePath: string): void;
  configureLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void;
  configureEmbeddingProviderForTest(provider: EmbeddingProvider): void;
  clearRecords(): void;
  addRecord(record: MemoryRecord): void;
  searchByKeyword(query: string): MemoryRecord[];
  searchByKeywordAsync(
    query: string,
    options?: VectorSearchOptions
  ): Promise<Array<MemoryRecord & { score?: number }>>;
  resetBackendForTest(): void;
}

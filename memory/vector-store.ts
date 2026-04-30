import { JsonlVectorStoreAdapter } from "./adapters/jsonl-vector-store.js";
import type { EmbeddingProvider, MemoryRecord } from "./vector-store-adapter.js";

const defaultAdapter = new JsonlVectorStoreAdapter();

export type { MemoryRecord, EmbeddingProvider };

export function configureVectorStoreForTest(filePath: string): void {
  defaultAdapter.configureStorageForTest(filePath);
}

export function configureVectorStoreLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void {
  defaultAdapter.configureLimitsForTest(limits);
}

export function configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
  defaultAdapter.configureEmbeddingProviderForTest(provider);
}

export function clearRecords(): void {
  defaultAdapter.clearRecords();
}

export function addRecord(record: MemoryRecord): void {
  defaultAdapter.addRecord(record);
}

export function searchByKeyword(query: string): MemoryRecord[] {
  return defaultAdapter.searchByKeyword(query);
}

export async function searchByKeywordAsync(
  query: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<Array<MemoryRecord & { score?: number }>> {
  return defaultAdapter.searchByKeywordAsync(query, options);
}

export function resetVectorBackendForTest(): void {
  defaultAdapter.resetBackendForTest();
}

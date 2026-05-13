import { JsonlVectorStoreAdapter } from "./adapters/jsonl-vector-store.js";
import { PgvectorVectorStoreAdapter } from "./adapters/pgvector-vector-store.js";
import { QdrantVectorStoreAdapter } from "./adapters/qdrant-vector-store.js";
import { LanceDBVectorStoreAdapter } from "./adapters/lancedb-vector-store.js";
import type { EmbeddingProvider, MemoryRecord, VectorStoreAdapter } from "./vector-store-adapter.js";

let defaultAdapter: VectorStoreAdapter | null = null;

function resolveVectorBackend(): string {
  return (process.env.SF_AI_VECTOR_BACKEND ?? "tfidf").trim().toLowerCase();
}

function buildAdapter(): VectorStoreAdapter {
  const backend = resolveVectorBackend();
  if (backend === "pgvector") {
    try {
      return new PgvectorVectorStoreAdapter();
    } catch {
      return new JsonlVectorStoreAdapter();
    }
  }
  if (backend === "qdrant") {
    return new QdrantVectorStoreAdapter();
  }
  if (backend === "lancedb") {
    return new LanceDBVectorStoreAdapter();
  }
  return new JsonlVectorStoreAdapter();
}

function getAdapter(): VectorStoreAdapter {
  if (!defaultAdapter) {
    defaultAdapter = buildAdapter();
  }
  return defaultAdapter;
}

export type { MemoryRecord, EmbeddingProvider };

export function configureVectorStoreForTest(filePath: string): void {
  getAdapter().configureStorageForTest(filePath);
}

export function configureVectorStoreLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void {
  getAdapter().configureLimitsForTest(limits);
}

export function configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
  getAdapter().configureEmbeddingProviderForTest(provider);
}

export function clearRecords(): void {
  getAdapter().clearRecords();
}

export function addRecord(record: MemoryRecord): void {
  getAdapter().addRecord(record);
}

export function searchByKeyword(query: string): MemoryRecord[] {
  return getAdapter().searchByKeyword(query);
}

export async function searchByKeywordAsync(
  query: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<Array<MemoryRecord & { score?: number }>> {
  return getAdapter().searchByKeywordAsync(query, options);
}

export function resetVectorBackendForTest(): void {
  if (defaultAdapter) {
    defaultAdapter.resetBackendForTest();
  }
  defaultAdapter = null;
}

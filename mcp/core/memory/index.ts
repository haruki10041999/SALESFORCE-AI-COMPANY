/**
 * Memory Layer - Unified Export
 *
 * This module consolidates all memory-related functionality:
 * - Vector store (pgvector / tfidf / memory)
 * - Hierarchical retrieval (chunk / section / document)
 * - Knowledge graph ingestion
 * - Failure memory
 * - Project memory (chat session memory)
 * - Memory tier classification (hot / warm / cold)
 */

// Vector store abstractions
export { type MemoryRecord, type EmbeddingProvider, type VectorSearchOptions, type VectorStoreAdapter } from "../../../memory/vector-store-adapter.js";
export { addRecord, searchByKeyword, searchByKeywordAsync, clearRecords, resetVectorBackendForTest, configureVectorStoreForTest, configureVectorStoreLimitsForTest, configureEmbeddingProviderForTest, type EmbeddingProvider as VectorStoreEmbeddingProvider } from "../../../memory/vector-store.js";
export { JsonlVectorStoreAdapter } from "../../../memory/adapters/jsonl-vector-store.js";

// Hierarchical retrieval
export { HierarchicalMemoryStore, type HierarchicalSearchOptions } from "../../../memory/hierarchical-store.js";
export { MemoryChunker, type ChunkedDocument } from "../../../memory/chunker.js";

// Knowledge graph
export {
  ingestKnowledgeSummary,
  searchHybrid as queryKnowledgeGraph,
  type KnowledgeEntity as KnowledgeGraphNode,
  type KnowledgeRelation as KnowledgeGraphEdge
} from "../../../memory/knowledge-graph.js";
export { extractEntitiesFromSummary, type GraphExtractionResult as ExtractionOptions } from "../../../memory/graph-extractor.js";

// Failure memory
export {
  configureFailureMemoryStorageForTest,
  recordFailureMemory,
  searchFailureMemory,
  listFailureMemory,
  type FailureMemoryEntry
} from "../../../memory/failure-memory.js";

// Project memory (session)
export {
  configureMemoryStorageForTest,
  configureMemoryLimitsForTest,
  addMemory,
  searchMemory,
  listMemory,
  clearMemory
} from "../../../memory/project-memory.js";

// Vector tier classification (hot / warm / cold)
export { classifyVectorTier, type VectorTierInput as VectorTierClassification } from "./vector-tier.js";


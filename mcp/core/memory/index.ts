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
export { HierarchicalMemoryStore, type HierarchicalSearchOptions, type HybridSearchResult, type KnowledgeGraphSearchOptions } from "../../../memory/hierarchical-store.js";
export { MemoryChunker, type ChunkedDocument } from "../../../memory/chunker.js";

// Knowledge graph
export {
  ingestKnowledgeSummary,
  searchHybrid as queryKnowledgeGraph,
  type KnowledgeEntity as KnowledgeGraphNode,
  type KnowledgeRelation as KnowledgeGraphEdge
} from "../../../memory/knowledge-graph.js";
export type {
  KnowledgeGraphPort,
  KnowledgeGraphHybridSearchResult,
  KnowledgeGraphNeighbors,
  TransitiveInference as KnowledgeGraphPortTransitiveInference,
  SimilarEntity as KnowledgeGraphPortSimilarEntity,
  GraphCommunity as KnowledgeGraphPortCommunity
} from "../ports/knowledge-graph-port.js";
export { createKnowledgeGraphAdapter, KnowledgeGraphAdapter } from "../../infrastructure/memory/knowledge-graph-adapter.js";
export { extractEntitiesFromSummary, type GraphExtractionResult as ExtractionOptions } from "../../../memory/graph-extractor.js";
export {
  inferTransitiveRelations,
  findSimilarEntities,
  detectCommunities,
  type TransitiveInference,
  type SimilarEntity,
  type GraphCommunity
} from "./kg-reasoner.js";

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

// Fine-grained memory ports (T07)
export type {
  HierarchicalMemoryPort,
  HierarchicalIngestInput,
  HierarchicalIngestResult,
  HierarchicalSearchInput,
  HierarchicalSearchOutput,
  VectorTier
} from "../ports/hierarchical-memory-port.js";
export type { MemoryReader, MemoryWriter, MemoryService } from "../ports/memory-service.js";

// Vector tier classification (hot / warm / cold)
export { classifyVectorTier, type VectorTierInput as VectorTierClassification } from "./vector-tier.js";

// Memory tier policy (T-17 increment 2)
export { MemoryTierPolicy, DEFAULT_TIER_CONFIG, type MemoryTier, type MemoryTierConfig, type MemoryTierMetrics } from "./memory-tier-policy.js";


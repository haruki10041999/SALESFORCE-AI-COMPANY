/**
 * VectorStore port — TASK-13: Vector DB Pluggable
 *
 * Abstraction over pgvector / qdrant / tfidf / memory backends.
 * All vector stores must implement this interface.
 */

export interface VectorRecord {
  /** Unique record identifier within the collection */
  id: string;
  /** Raw text for full-text / TF-IDF fallback */
  text: string;
  /** Dense embedding vector */
  vector?: number[];
  /** Arbitrary filterable metadata */
  metadata?: Record<string, unknown>;
  /** Tier hint for hierarchical stores */
  tier?: "hot" | "warm" | "cold";
}

export interface VectorFilterSpec {
  /** Exact-match field conditions (AND-combined) */
  must?: Record<string, unknown>;
  /** At least one of these conditions must match */
  should?: Record<string, unknown>;
  /** None of these conditions must match */
  mustNot?: Record<string, unknown>;
}

export interface VectorQueryOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity score threshold (0–1, default: 0) */
  minScore?: number;
  /** Optional structured filter applied before scoring */
  filter?: VectorFilterSpec;
}

export interface VectorQueryResult {
  record: VectorRecord;
  /** Similarity / relevance score (higher = more similar) */
  score: number;
}

/**
 * Core VectorStore interface.
 * Implementations must be backend-agnostic and provide consistent semantics
 * for upsert / query / delete operations.
 */
export interface VectorStore {
  /**
   * Insert or update a record.
   * If a record with the same `id` already exists it is replaced atomically.
   */
  upsert(record: VectorRecord): Promise<void>;

  /**
   * Search by semantic similarity or keyword, returning scored results.
   * Implementations that lack embeddings may fall back to keyword scoring.
   */
  query(queryText: string, options?: VectorQueryOptions): Promise<VectorQueryResult[]>;

  /**
   * Remove a record by id.
   * Silently succeeds if the record does not exist.
   */
  delete(id: string): Promise<void>;

  /**
   * Retrieve a single record by id.
   * Returns `undefined` if not found.
   */
  get(id: string): Promise<VectorRecord | undefined>;

  /**
   * Remove all records from the store.
   * Used primarily in tests and maintenance workflows.
   */
  clear(): Promise<void>;
}

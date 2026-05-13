/**
 * QdrantVectorStore — TASK-13: Vector DB Pluggable
 *
 * Adapter for Qdrant vector database using the REST API (no native client dependency).
 * Connects to a Qdrant instance specified by QDRANT_URL (default: http://localhost:6333).
 *
 * Collection name: SF_AI_QDRANT_COLLECTION (default: "sfai_memory").
 * Vector dimension:  SF_AI_QDRANT_DIMENSION (default: 768).
 * Distance metric:   SF_AI_QDRANT_DISTANCE  (default: "Cosine").
 */

import type { VectorStore, VectorRecord, VectorQueryOptions, VectorQueryResult } from "../ports/vector-store.js";

interface QdrantPointStruct {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

interface QdrantScoredPoint {
  id: string;
  score: number;
  payload?: Record<string, unknown>;
}

interface QdrantSearchRequest {
  vector: number[];
  limit: number;
  score_threshold?: number;
  filter?: Record<string, unknown>;
  with_payload: boolean;
}

export interface QdrantVectorStoreOptions {
  url?: string;
  collection?: string;
  dimension?: number;
  distance?: "Cosine" | "Dot" | "Euclid";
  apiKey?: string;
}

function buildFilter(filter?: VectorQueryOptions["filter"]): Record<string, unknown> | undefined {
  if (!filter) return undefined;

  const conditions: Record<string, unknown>[] = [];

  if (filter.must) {
    for (const [key, value] of Object.entries(filter.must)) {
      conditions.push({ key, match: { value } });
    }
  }
  if (filter.mustNot) {
    const mustNotClauses: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(filter.mustNot)) {
      mustNotClauses.push({ key, match: { value } });
    }
    return { must: conditions.length ? conditions : undefined, must_not: mustNotClauses };
  }

  return conditions.length ? { must: conditions } : undefined;
}

/**
 * Pad or truncate a vector to the target dimension.
 */
function normalizeVector(vec: number[], dimension: number): number[] {
  if (vec.length === dimension) return vec;
  if (vec.length > dimension) return vec.slice(0, dimension);
  const out = vec.slice();
  while (out.length < dimension) out.push(0);
  return out;
}

export class QdrantVectorStore implements VectorStore {
  private readonly url: string;
  private readonly collection: string;
  private readonly dimension: number;
  private readonly distance: "Cosine" | "Dot" | "Euclid";
  private readonly headers: Record<string, string>;
  private collectionReady: Promise<void> | null = null;

  constructor(options: QdrantVectorStoreOptions = {}) {
    this.url = (options.url ?? process.env.QDRANT_URL ?? "http://localhost:6333").replace(/\/$/, "");
    this.collection = options.collection ?? process.env.SF_AI_QDRANT_COLLECTION ?? "sfai_memory";
    this.dimension = options.dimension ?? Number(process.env.SF_AI_QDRANT_DIMENSION ?? 768);
    this.distance = (options.distance ?? (process.env.SF_AI_QDRANT_DISTANCE as "Cosine") ?? "Cosine");
    this.headers = {
      "Content-Type": "application/json",
      ...(options.apiKey ?? process.env.QDRANT_API_KEY
        ? { "api-key": (options.apiKey ?? process.env.QDRANT_API_KEY) as string }
        : {}),
    };
  }

  // ------------------------------------------------------------------
  // Collection lifecycle
  // ------------------------------------------------------------------

  private ensureCollection(): Promise<void> {
    if (!this.collectionReady) {
      this.collectionReady = this._ensureCollection();
    }
    return this.collectionReady;
  }

  private async _ensureCollection(): Promise<void> {
    const checkRes = await fetch(`${this.url}/collections/${this.collection}`, {
      headers: this.headers,
    });
    if (checkRes.status === 200) return;

    const createRes = await fetch(`${this.url}/collections/${this.collection}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({
        vectors: {
          size: this.dimension,
          distance: this.distance,
        },
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Qdrant: failed to create collection "${this.collection}": ${body}`);
    }
  }

  // ------------------------------------------------------------------
  // VectorStore interface
  // ------------------------------------------------------------------

  async upsert(record: VectorRecord): Promise<void> {
    await this.ensureCollection();

    const vector = record.vector ? normalizeVector(record.vector, this.dimension) : new Array(this.dimension).fill(0) as number[];

    const point: QdrantPointStruct = {
      id: record.id,
      vector,
      payload: {
        text: record.text,
        tier: record.tier ?? "hot",
        ...(record.metadata ?? {}),
      },
    };

    const res = await fetch(`${this.url}/collections/${this.collection}/points`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({ points: [point] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant: upsert failed: ${body}`);
    }
  }

  async query(queryText: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult[]> {
    await this.ensureCollection();

    // Build a naive sparse vector from query text length hash for keyword fallback
    // In production the caller should pre-embed queryText and pass a dense vector.
    const queryVector = new Array(this.dimension).fill(0) as number[];
    // Use text characters to seed non-zero dimensions for basic keyword matching
    for (let i = 0; i < queryText.length; i++) {
      queryVector[i % this.dimension] += queryText.charCodeAt(i) / 1000;
    }

    const request: QdrantSearchRequest = {
      vector: queryVector,
      limit: options.limit ?? 10,
      with_payload: true,
      ...(options.minScore != null ? { score_threshold: options.minScore } : {}),
      ...(options.filter ? { filter: buildFilter(options.filter) } : {}),
    };

    const res = await fetch(`${this.url}/collections/${this.collection}/points/search`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant: search failed: ${body}`);
    }

    const data = (await res.json()) as { result: QdrantScoredPoint[] };
    return (data.result ?? []).map((p) => ({
      score: p.score,
      record: {
        id: String(p.id),
        text: String(p.payload?.text ?? ""),
        tier: (p.payload?.tier as VectorRecord["tier"]) ?? "hot",
        metadata: Object.fromEntries(
          Object.entries(p.payload ?? {}).filter(([k]) => k !== "text" && k !== "tier")
        ),
      },
    }));
  }

  async delete(id: string): Promise<void> {
    await this.ensureCollection();

    const res = await fetch(`${this.url}/collections/${this.collection}/points/delete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ points: [id] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant: delete failed: ${body}`);
    }
  }

  async get(id: string): Promise<VectorRecord | undefined> {
    await this.ensureCollection();

    const res = await fetch(`${this.url}/collections/${this.collection}/points/${id}`, {
      headers: this.headers,
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant: get failed: ${body}`);
    }

    const data = (await res.json()) as { result: { id: string; payload?: Record<string, unknown> } };
    const payload = data.result?.payload ?? {};
    return {
      id,
      text: String(payload.text ?? ""),
      tier: (payload.tier as VectorRecord["tier"]) ?? "hot",
      metadata: Object.fromEntries(
        Object.entries(payload).filter(([k]) => k !== "text" && k !== "tier")
      ),
    };
  }

  async clear(): Promise<void> {
    const res = await fetch(`${this.url}/collections/${this.collection}`, {
      method: "DELETE",
      headers: this.headers,
    });
    // Accept 200 or 404 (already deleted)
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Qdrant: clear (collection delete) failed: ${body}`);
    }
    // Reset so the collection will be recreated on next operation
    this.collectionReady = null;
  }

  /** Factory helper */
  static create(options: QdrantVectorStoreOptions = {}): QdrantVectorStore {
    return new QdrantVectorStore(options);
  }
}

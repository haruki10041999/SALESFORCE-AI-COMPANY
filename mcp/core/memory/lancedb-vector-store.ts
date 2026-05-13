/**
 * LanceDBVectorStore — TASK-13: Vector DB Pluggable
 *
 * Adapter for LanceDB (embedded columnar vector database).
 * Uses dynamic import so the optional `vectordb` package is not required at startup.
 *
 * Database path: SF_AI_LANCEDB_URI (default: "./data/lancedb").
 * Table name:    SF_AI_LANCEDB_TABLE (default: "sfai_memory").
 * Vector dim:    SF_AI_LANCEDB_DIMENSION (default: 768).
 *
 * LanceDB is embedded, so no separate server process is required.
 */

import type { VectorStore, VectorRecord, VectorQueryOptions, VectorQueryResult } from "../ports/vector-store.js";

export interface LanceDBVectorStoreOptions {
  uri?: string;
  table?: string;
  dimension?: number;
}

interface LanceRow {
  id: string;
  text: string;
  tier: string;
  vector: number[];
  [key: string]: unknown;
}

function normalizeVector(vec: number[], dimension: number): number[] {
  if (vec.length === dimension) return vec;
  if (vec.length > dimension) return vec.slice(0, dimension);
  const out = vec.slice();
  while (out.length < dimension) out.push(0);
  return out;
}

function buildDenseVector(text: string, dimension: number): number[] {
  const vec = new Array(dimension).fill(0) as number[];
  for (let i = 0; i < text.length; i++) {
    vec[i % dimension] += text.charCodeAt(i) / 1000;
  }
  return vec;
}

export class LanceDBVectorStore implements VectorStore {
  private readonly uri: string;
  private readonly tableName: string;
  private readonly dimension: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tbl: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: LanceDBVectorStoreOptions = {}) {
    this.uri = options.uri ?? process.env.SF_AI_LANCEDB_URI ?? "./data/lancedb";
    this.tableName = options.table ?? process.env.SF_AI_LANCEDB_TABLE ?? "sfai_memory";
    this.dimension = options.dimension ?? Number(process.env.SF_AI_LANCEDB_DIMENSION ?? 768);
  }

  // ------------------------------------------------------------------
  // Initialisation (lazy)
  // ------------------------------------------------------------------

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    // Dynamic import keeps `vectordb` optional at module load time
    // @ts-expect-error — optional peer dependency; install with: npm install vectordb
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const lancedb = await import("vectordb").catch(() => {
      throw new Error(
        "LanceDBVectorStore requires the 'vectordb' package. " +
          "Install it with: npm install vectordb"
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.db = await lancedb.connect(this.uri);

    // Attempt to open existing table; create if absent
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      this.tbl = await this.db.openTable(this.tableName);
    } catch {
      const emptyVector = new Array(this.dimension).fill(0) as number[];
      const seed: LanceRow[] = [
        {
          id: "__init__",
          text: "",
          tier: "hot",
          vector: emptyVector,
        },
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      this.tbl = await this.db.createTable(this.tableName, seed);
      // Remove seed record
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await this.tbl.delete('id = "__init__"');
    }
  }

  // ------------------------------------------------------------------
  // VectorStore interface
  // ------------------------------------------------------------------

  async upsert(record: VectorRecord): Promise<void> {
    await this.init();

    const vector = record.vector
      ? normalizeVector(record.vector, this.dimension)
      : buildDenseVector(record.text, this.dimension);

    const row: LanceRow = {
      id: record.id,
      text: record.text,
      tier: record.tier ?? "hot",
      vector,
      ...(record.metadata ?? {}),
    };

    // Delete existing record with same id, then insert (LanceDB has no native upsert)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.tbl.delete(`id = "${record.id.replace(/"/g, '\\"')}"`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.tbl.add([row]);
  }

  async query(queryText: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult[]> {
    await this.init();

    const queryVector = buildDenseVector(queryText, this.dimension);
    const limit = options.limit ?? 10;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    let q = this.tbl.search(queryVector).limit(limit);
    if (options.minScore != null) {
      // LanceDB returns _distance; score = 1 - distance for Cosine
      // filter by distance <= 1 - minScore
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      q = q.where(`_distance <= ${1 - options.minScore}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const rows: (LanceRow & { _distance?: number })[] = await q.execute();

    return rows
      .filter((r) => r.id !== "__init__")
      .map((r) => ({
        score: r._distance != null ? Math.max(0, 1 - r._distance) : 0,
        record: {
          id: r.id,
          text: r.text,
          tier: (r.tier as VectorRecord["tier"]) ?? "hot",
          metadata: Object.fromEntries(
            Object.entries(r).filter(([k]) => !["id", "text", "tier", "vector", "_distance"].includes(k))
          ),
        },
      }));
  }

  async delete(id: string): Promise<void> {
    await this.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.tbl.delete(`id = "${id.replace(/"/g, '\\"')}"`);
  }

  async get(id: string): Promise<VectorRecord | undefined> {
    await this.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const rows: LanceRow[] = await this.tbl.search(new Array(this.dimension).fill(0) as number[])
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      .where(`id = "${id.replace(/"/g, '\\"')}"`)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      .limit(1)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      .execute();
    const r = rows.find((x) => x.id === id);
    if (!r) return undefined;
    return {
      id: r.id,
      text: r.text,
      tier: (r.tier as VectorRecord["tier"]) ?? "hot",
      metadata: Object.fromEntries(
        Object.entries(r).filter(([k]) => !["id", "text", "tier", "vector", "_distance"].includes(k))
      ),
    };
  }

  async clear(): Promise<void> {
    if (!this.initPromise) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await this.db?.dropTable(this.tableName);
    this.tbl = null;
    this.initPromise = null;
  }

  /** Factory helper */
  static create(options: LanceDBVectorStoreOptions = {}): LanceDBVectorStore {
    return new LanceDBVectorStore(options);
  }
}

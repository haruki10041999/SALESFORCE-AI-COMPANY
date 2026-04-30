import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createLogger } from "../../mcp/core/logging/logger.js";
import { atomicWriteFileSync } from "../../mcp/core/io/atomic-write.js";
import {
  createEmbeddingProvider,
  cosineSimilarity,
  type VectorEmbeddingProvider
} from "../../mcp/core/llm/embedding-provider.js";
import type {
  EmbeddingProvider,
  MemoryRecord,
  VectorSearchOptions,
  VectorStoreAdapter
} from "../vector-store-adapter.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_VECTOR_STORE_FILE = join(ROOT, "outputs", "vector-store.jsonl");

type VectorBackendKind = "tfidf" | "ngram" | "ollama";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_\-\u3040-\u30ff\u4e00-\u9faf]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

class TfidfEmbeddingProvider implements EmbeddingProvider {
  search(allRecords: MemoryRecord[], query: string): MemoryRecord[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || allRecords.length === 0) {
      return [];
    }

    const docTokens = allRecords.map((record) => tokenize(`${record.text} ${(record.tags ?? []).join(" ")}`));
    const docCount = docTokens.length;
    const df = new Map<string, number>();
    for (const tokens of docTokens) {
      const unique = new Set(tokens);
      for (const token of unique) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }

    const scored = allRecords
      .map((record, index) => {
        const tokens = docTokens[index];
        if (tokens.length === 0) {
          return { record, score: 0 };
        }
        const tf = new Map<string, number>();
        for (const token of tokens) {
          tf.set(token, (tf.get(token) ?? 0) + 1);
        }
        let score = 0;
        for (const queryToken of queryTokens) {
          const termFreq = (tf.get(queryToken) ?? 0) / tokens.length;
          if (termFreq === 0) {
            continue;
          }
          const docFreq = df.get(queryToken) ?? 0;
          const idf = Math.log((1 + docCount) / (1 + docFreq)) + 1;
          score += termFreq * idf;
        }
        return { record, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.record);
  }
}

function fastHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class JsonlVectorStoreAdapter implements VectorStoreAdapter {
  private readonly records: MemoryRecord[] = [];
  private readonly logger = createLogger("VectorStore");
  private storageFilePath = process.env.SF_AI_VECTOR_STORE_FILE ?? DEFAULT_VECTOR_STORE_FILE;
  private maxRecords = Number.parseInt(process.env.SF_AI_VECTOR_MAX_RECORDS ?? "5000", 10);
  private maxBytes = Number.parseInt(process.env.SF_AI_VECTOR_MAX_BYTES ?? `${2 * 1024 * 1024}`, 10);
  private warnedLargeStore = false;
  private embeddingProvider: EmbeddingProvider = new TfidfEmbeddingProvider();
  private vectorBackend: VectorEmbeddingProvider | null = null;
  private vectorBackendKind: VectorBackendKind | null = null;
  private readonly recordVectorCache = new Map<string, { hash: string; vector: number[] }>();

  constructor() {
    this.loadFromDisk();
  }

  public configureStorageForTest(filePath: string): void {
    this.storageFilePath = filePath;
    this.loadFromDisk();
  }

  public configureLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void {
    if (typeof limits.maxRecords === "number") {
      this.maxRecords = limits.maxRecords;
    }
    if (typeof limits.maxBytes === "number") {
      this.maxBytes = limits.maxBytes;
    }
    this.normalizeLimits();
    this.applyRetention();
    this.saveToDisk();
  }

  public configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  public clearRecords(): void {
    this.records.length = 0;
    this.saveToDisk();
  }

  public addRecord(record: MemoryRecord): void {
    const existingIndex = this.records.findIndex((r) => r.id === record.id);
    if (existingIndex >= 0) {
      this.records.splice(existingIndex, 1);
    }
    this.records.push(record);
    this.saveToDisk();
  }

  public searchByKeyword(query: string): MemoryRecord[] {
    const results = this.embeddingProvider.search(this.records, query);
    for (const result of results) {
      this.touchRecordById(result.id);
    }
    if (results.length > 0) {
      this.saveToDisk();
    }
    return results;
  }

  public async searchByKeywordAsync(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<Array<MemoryRecord & { score?: number }>> {
    if (this.records.length === 0 || query.trim().length === 0) return [];

    const backend = this.getVectorBackend();
    if (!backend) {
      return this.searchByKeyword(query);
    }

    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;
    const queryVec = await backend.embed(query);
    const scored: Array<{ record: MemoryRecord; score: number }> = [];
    for (const record of this.records) {
      const recVec = await this.getRecordVector(backend, record);
      const score = cosineSimilarity(queryVec, recVec);
      if (score > minScore) scored.push({ record, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    for (const entry of top) this.touchRecordById(entry.record.id);
    if (top.length > 0) this.saveToDisk();
    return top.map((entry) => ({ ...entry.record, score: entry.score }));
  }

  public resetBackendForTest(): void {
    this.vectorBackend = null;
    this.vectorBackendKind = null;
    this.recordVectorCache.clear();
  }

  private normalizeLimits(): void {
    if (!Number.isFinite(this.maxRecords) || this.maxRecords < 10) {
      this.maxRecords = 5000;
    }
    if (!Number.isFinite(this.maxBytes) || this.maxBytes < 1024) {
      this.maxBytes = 2 * 1024 * 1024;
    }
  }

  private applyRetention(): void {
    if (this.records.length > this.maxRecords) {
      const overflow = this.records.length - this.maxRecords;
      if (overflow > 0) {
        this.records.splice(0, overflow);
      }
    }

    if (this.records.length > 10000 && !this.warnedLargeStore) {
      this.warnedLargeStore = true;
      this.logger.warn("records exceed 10000; consider raising storage limits carefully or pruning old entries.");
    }
  }

  private touchRecordById(id: string): void {
    const index = this.records.findIndex((r) => r.id === id);
    if (index <= -1) return;
    if (index === this.records.length - 1) return;
    const [record] = this.records.splice(index, 1);
    if (record) {
      this.records.push(record);
    }
  }

  private archivePayloadIfNeeded(payload: string): string {
    const bytes = Buffer.byteLength(payload, "utf-8");
    if (bytes <= this.maxBytes) {
      return payload;
    }

    try {
      const archivePath = `${this.storageFilePath}.${Date.now()}.gz`;
      writeFileSync(archivePath, gzipSync(payload));
    } catch {
      // ignore archive write failures
    }

    const keep = Math.max(10, Math.floor(this.maxRecords / 2));
    if (this.records.length > keep) {
      this.records.splice(0, this.records.length - keep);
    }

    const trimmed = this.records.map((record) => JSON.stringify(record)).join("\n");
    return trimmed.length > 0 ? `${trimmed}\n` : "";
  }

  private loadFromDisk(): void {
    this.records.length = 0;
    this.normalizeLimits();
    if (!existsSync(this.storageFilePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFilePath, "utf-8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Partial<MemoryRecord>;
          if (
            typeof parsed.id === "string" &&
            typeof parsed.text === "string" &&
            Array.isArray(parsed.tags) &&
            parsed.tags.every((tag) => typeof tag === "string")
          ) {
            this.records.push({ id: parsed.id, text: parsed.text, tags: [...parsed.tags] });
          }
        } catch {
          // skip corrupted rows
        }
      }
      this.applyRetention();
    } catch {
      // keep in-memory only on read errors
    }
  }

  private saveToDisk(): void {
    try {
      this.normalizeLimits();
      this.applyRetention();
      mkdirSync(dirname(this.storageFilePath), { recursive: true });
      const payload = this.records.map((record) => JSON.stringify(record)).join("\n");
      const content = this.archivePayloadIfNeeded(payload.length > 0 ? `${payload}\n` : "");
      atomicWriteFileSync(this.storageFilePath, content, "utf-8");
    } catch {
      // keep API non-throwing
    }
  }

  private resolveBackendKind(): VectorBackendKind {
    const raw = (process.env.SF_AI_VECTOR_BACKEND ?? "tfidf").toLowerCase();
    if (raw === "ngram" || raw === "ollama") return raw;
    return "tfidf";
  }

  private getVectorBackend(): VectorEmbeddingProvider | null {
    const kind = this.resolveBackendKind();
    if (kind === "tfidf") {
      this.vectorBackend = null;
      this.vectorBackendKind = null;
      return null;
    }
    if (this.vectorBackend && this.vectorBackendKind === kind) return this.vectorBackend;

    const env = { ...process.env, EMBEDDING_PROVIDER: kind === "ngram" ? "ngram" : "ollama" };
    this.vectorBackend = createEmbeddingProvider({ env });
    this.vectorBackendKind = kind;
    this.recordVectorCache.clear();
    return this.vectorBackend;
  }

  private async getRecordVector(
    provider: VectorEmbeddingProvider,
    record: MemoryRecord
  ): Promise<number[]> {
    const text = `${record.text} ${(record.tags ?? []).join(" ")}`;
    const hash = fastHash(`${record.id}\u0001${text}`);
    const cached = this.recordVectorCache.get(record.id);
    if (cached && cached.hash === hash) return cached.vector;
    const vector = await provider.embed(text);
    this.recordVectorCache.set(record.id, { hash, vector });
    return vector;
  }
}

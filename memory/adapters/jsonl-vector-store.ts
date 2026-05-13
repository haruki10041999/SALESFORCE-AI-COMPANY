import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
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
import {
  createAtRestCryptoFromEnv,
  parseEncryptedEnvelope,
  type EncryptedEnvelope
} from "../../mcp/core/security/at-rest-crypto.js";
import { classifyVectorTier } from "../../mcp/core/memory/vector-tier.js";
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

interface TfidfCacheEntry {
  fingerprint: string;
  docTokens: string[][];
  df: Map<string, number>;
  docCount: number;
}

function fingerprintRecords(records: MemoryRecord[]): string {
  // Cheap content-version tag: count + head/tail id + tail text length.
  // Collisions require all three to coincide while contents differ — negligible
  // in practice, and a wrong cache hit only affects ranking, not correctness of identity.
  if (records.length === 0) return "0";
  const head = records[0];
  const tail = records[records.length - 1];
  return `${records.length}\u0001${head?.id ?? ""}\u0001${tail?.id ?? ""}\u0001${tail?.text.length ?? 0}`;
}

class TfidfEmbeddingProvider implements EmbeddingProvider {
  // WeakMap keyed by the records array reference. The adapter reuses the same
  // array instance across searches, so this keeps cache lifetime tied to the
  // owning store without leaking memory in tests that allocate fresh arrays.
  private readonly cache = new WeakMap<MemoryRecord[], TfidfCacheEntry>();

  /** @internal exposed for tests to verify cache behavior */
  public _peekCacheFingerprint(records: MemoryRecord[]): string | undefined {
    return this.cache.get(records)?.fingerprint;
  }

  search(allRecords: MemoryRecord[], query: string): MemoryRecord[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || allRecords.length === 0) {
      return [];
    }

    const fingerprint = fingerprintRecords(allRecords);
    let cached = this.cache.get(allRecords);
    if (!cached || cached.fingerprint !== fingerprint) {
      const docTokens = allRecords.map((record) => tokenize(`${record.text} ${(record.tags ?? []).join(" ")}`));
      const df = new Map<string, number>();
      for (const tokens of docTokens) {
        const unique = new Set(tokens);
        for (const token of unique) {
          df.set(token, (df.get(token) ?? 0) + 1);
        }
      }
      cached = { fingerprint, docTokens, df, docCount: docTokens.length };
      this.cache.set(allRecords, cached);
    }
    const { docTokens, df, docCount } = cached;

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

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.alg === "string"
    && typeof record.keyId === "string"
    && typeof record.iv === "string"
    && typeof record.tag === "string"
    && typeof record.ciphertext === "string";
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
  private vectorCacheMaxEntries = Number.parseInt(process.env.SF_AI_VECTOR_CACHE_MAX_ENTRIES ?? "2000", 10);

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
    const tier = record.tier ?? classifyVectorTier({ text: record.text, tags: record.tags });
    const existingIndex = this.records.findIndex((r) => r.id === record.id);
    if (existingIndex >= 0) {
      this.records.splice(existingIndex, 1);
    }
    this.records.push({ ...record, tier });
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
    if (!Number.isFinite(this.vectorCacheMaxEntries) || this.vectorCacheMaxEntries < 100) {
      this.vectorCacheMaxEntries = 2000;
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

    const MAX_STREAMED_RECORDS = 10000;
    const atRestCrypto = createAtRestCryptoFromEnv();
    if (atRestCrypto) {
      try {
        const raw = readFileSync(this.storageFilePath, "utf-8");
        const trimmed = raw.trim();
        if (trimmed.length > 0) {
          const parsed = parseEncryptedEnvelope(trimmed);
          if (isEncryptedEnvelope(parsed)) {
            const plainText = atRestCrypto.decryptUtf8(parsed);
            const lines = plainText.split(/\r?\n/);
            for (const lineRaw of lines) {
              const line = lineRaw.trim();
              if (line.length === 0) continue;
              try {
                const rec = JSON.parse(line) as Partial<MemoryRecord>;
                if (
                  typeof rec.id === "string"
                  && typeof rec.text === "string"
                  && Array.isArray(rec.tags)
                  && rec.tags.every((tag) => typeof tag === "string")
                ) {
                  this.records.push({
                    id: rec.id,
                    text: rec.text,
                    tags: [...rec.tags],
                    tier: rec.tier === "hot" || rec.tier === "warm" || rec.tier === "cold" ? rec.tier : undefined
                  });
                }
              } catch {
                // skip corrupted rows
              }
            }
            this.applyRetention();
            return;
          }
        }
      } catch {
        // fall through to plaintext streaming loader
      }
    }

    try {
      const fd = openSync(this.storageFilePath, "r");
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let rest = "";
        let validCount = 0;

        const ingestLine = (lineRaw: string): void => {
          const line = lineRaw.trim();
          if (line.length === 0) return;
          try {
            const parsed = JSON.parse(line) as Partial<MemoryRecord>;
            if (
              typeof parsed.id === "string" &&
              typeof parsed.text === "string" &&
              Array.isArray(parsed.tags) &&
              parsed.tags.every((tag) => typeof tag === "string")
            ) {
              this.records.push({
                id: parsed.id,
                text: parsed.text,
                tags: [...parsed.tags],
                tier: parsed.tier === "hot" || parsed.tier === "warm" || parsed.tier === "cold" ? parsed.tier : undefined
              });
              validCount += 1;
              if (validCount > MAX_STREAMED_RECORDS && this.records.length > this.maxRecords) {
                const overflow = this.records.length - this.maxRecords;
                if (overflow > 0) {
                  this.records.splice(0, overflow);
                }
              }
            }
          } catch {
            // skip corrupted rows
          }
        };

        for (;;) {
          const bytes = readSync(fd, buffer, 0, buffer.length, null);
          if (bytes <= 0) break;
          const chunk = rest + buffer.toString("utf-8", 0, bytes);
          const lines = chunk.split(/\r?\n/);
          rest = lines.pop() ?? "";
          for (const line of lines) {
            ingestLine(line);
          }
        }
        if (rest.trim().length > 0) {
          ingestLine(rest);
        }
      } finally {
        closeSync(fd);
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
      const atRestCrypto = createAtRestCryptoFromEnv();
      if (!atRestCrypto) {
        atomicWriteFileSync(this.storageFilePath, content, "utf-8");
        return;
      }
      const encrypted = atRestCrypto.encryptUtf8(content);
      atomicWriteFileSync(this.storageFilePath, `${JSON.stringify(encrypted)}\n`, "utf-8");
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
    if (cached && cached.hash === hash) {
      this.recordVectorCache.delete(record.id);
      this.recordVectorCache.set(record.id, cached);
      return cached.vector;
    }
    const vector = await provider.embed(text);
    this.recordVectorCache.set(record.id, { hash, vector });
    if (this.recordVectorCache.size > this.vectorCacheMaxEntries) {
      const oldestKey = this.recordVectorCache.keys().next().value;
      if (typeof oldestKey === "string") {
        this.recordVectorCache.delete(oldestKey);
      }
    }
    return vector;
  }
}

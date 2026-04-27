import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createLogger } from "../mcp/core/logging/logger.js";
import {
  createEmbeddingProvider,
  cosineSimilarity,
  type VectorEmbeddingProvider
} from "../mcp/core/llm/embedding-provider.js";

export type MemoryRecord = {
  id: string;
  text: string;
  tags: string[];
};

export interface EmbeddingProvider {
  search(records: MemoryRecord[], query: string): MemoryRecord[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VECTOR_STORE_FILE = join(ROOT, "outputs", "vector-store.jsonl");

const records: MemoryRecord[] = [];
const logger = createLogger("VectorStore");
let storageFilePath = process.env.SF_AI_VECTOR_STORE_FILE ?? DEFAULT_VECTOR_STORE_FILE;
let maxRecords = Number.parseInt(process.env.SF_AI_VECTOR_MAX_RECORDS ?? "5000", 10);
let maxBytes = Number.parseInt(process.env.SF_AI_VECTOR_MAX_BYTES ?? `${2 * 1024 * 1024}`, 10);
let warnedLargeStore = false;

function normalizeLimits(): void {
  if (!Number.isFinite(maxRecords) || maxRecords < 10) {
    maxRecords = 5000;
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 1024) {
    maxBytes = 2 * 1024 * 1024;
  }
}

function applyRetention(): void {
  if (records.length > maxRecords) {
    const overflow = records.length - maxRecords;
    if (overflow > 0) {
      records.splice(0, overflow);
    }
  }

  if (records.length > 10000 && !warnedLargeStore) {
    warnedLargeStore = true;
    logger.warn("records exceed 10000; consider raising storage limits carefully or pruning old entries.");
  }
}

function touchRecordById(id: string): void {
  const index = records.findIndex((r) => r.id === id);
  if (index <= -1) return;
  if (index === records.length - 1) return;
  const [record] = records.splice(index, 1);
  if (record) {
    records.push(record);
  }
}

function archivePayloadIfNeeded(payload: string): string {
  const bytes = Buffer.byteLength(payload, "utf-8");
  if (bytes <= maxBytes) {
    return payload;
  }

  try {
    const archivePath = `${storageFilePath}.${Date.now()}.gz`;
    writeFileSync(archivePath, gzipSync(payload));
  } catch {
    // ignore archive write failures
  }

  const keep = Math.max(10, Math.floor(maxRecords / 2));
  if (records.length > keep) {
    records.splice(0, records.length - keep);
  }

  const trimmed = records.map((record) => JSON.stringify(record)).join("\n");
  return trimmed.length > 0 ? `${trimmed}\n` : "";
}

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

let embeddingProvider: EmbeddingProvider = new TfidfEmbeddingProvider();

function loadFromDisk(): void {
  records.length = 0;
  normalizeLimits();
  if (!existsSync(storageFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(storageFilePath, "utf-8");
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
          records.push({ id: parsed.id, text: parsed.text, tags: [...parsed.tags] });
        }
      } catch {
        // 破損行は無視して残りのロードを継続する。
      }
    }
    applyRetention();
  } catch {
    // 読み込み失敗時はインメモリのまま継続する。
  }
}

function saveToDisk(): void {
  try {
    normalizeLimits();
    applyRetention();
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const payload = records.map((record) => JSON.stringify(record)).join("\n");
    const content = archivePayloadIfNeeded(payload.length > 0 ? `${payload}\n` : "");
    writeFileSync(storageFilePath, content, "utf-8");
  } catch {
    // ツール実行を落とさないため保存失敗は握りつぶす。
  }
}

loadFromDisk();

export function configureVectorStoreForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
}

export function configureVectorStoreLimitsForTest(limits: { maxRecords?: number; maxBytes?: number }): void {
  if (typeof limits.maxRecords === "number") {
    maxRecords = limits.maxRecords;
  }
  if (typeof limits.maxBytes === "number") {
    maxBytes = limits.maxBytes;
  }
  normalizeLimits();
  applyRetention();
  saveToDisk();
}

export function configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
  embeddingProvider = provider;
}

export function clearRecords(): void {
  records.length = 0;
  saveToDisk();
}

export function addRecord(record: MemoryRecord): void {
  const existingIndex = records.findIndex((r) => r.id === record.id);
  if (existingIndex >= 0) {
    records.splice(existingIndex, 1);
  }
  // LRU: 新規追加・更新を末尾へ移動
  records.push(record);
  saveToDisk();
}

export function searchByKeyword(query: string): MemoryRecord[] {
  const results = embeddingProvider.search(records, query);
  // LRU: 検索ヒットしたレコードを末尾へ移動
  for (const result of results) {
    touchRecordById(result.id);
  }
  if (results.length > 0) {
    saveToDisk();
  }
  return results;
}

// ============================================================
// F-11: VectorEmbeddingProvider バックエンド
// ----------------------------------------------------------------
// 既存の同期 search() (TF-IDF) はそのまま維持し、async な
// searchByKeywordAsync() を追加する。バックエンドは env
// `SF_AI_VECTOR_BACKEND` (`tfidf` | `ngram` | `ollama`) で選択し、
// `ngram` / `ollama` の場合は VectorEmbeddingProvider と cosine
// 類似度でランキングする。レコード埋め込みは id+text のハッシュで
// メモリキャッシュし、変更時のみ再計算する。
// ============================================================

type VectorBackendKind = "tfidf" | "ngram" | "ollama";

let vectorBackend: VectorEmbeddingProvider | null = null;
let vectorBackendKind: VectorBackendKind | null = null;
const recordVectorCache = new Map<string, { hash: string; vector: number[] }>();

function fastHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function resolveBackendKind(): VectorBackendKind {
  const raw = (process.env.SF_AI_VECTOR_BACKEND ?? "tfidf").toLowerCase();
  if (raw === "ngram" || raw === "ollama") return raw;
  return "tfidf";
}

function getVectorBackend(): VectorEmbeddingProvider | null {
  const kind = resolveBackendKind();
  if (kind === "tfidf") {
    vectorBackend = null;
    vectorBackendKind = null;
    return null;
  }
  if (vectorBackend && vectorBackendKind === kind) return vectorBackend;
  // ngram / ollama を要求された場合はファクトリで生成
  // (ngram のみ要求でも EMBEDDING_PROVIDER=ngram を環境に合わせる)
  const env = { ...process.env, EMBEDDING_PROVIDER: kind === "ngram" ? "ngram" : "ollama" };
  vectorBackend = createEmbeddingProvider({ env });
  vectorBackendKind = kind;
  recordVectorCache.clear();
  return vectorBackend;
}

async function getRecordVector(
  provider: VectorEmbeddingProvider,
  record: MemoryRecord
): Promise<number[]> {
  const text = `${record.text} ${(record.tags ?? []).join(" ")}`;
  const hash = fastHash(`${record.id}\u0001${text}`);
  const cached = recordVectorCache.get(record.id);
  if (cached && cached.hash === hash) return cached.vector;
  const vector = await provider.embed(text);
  recordVectorCache.set(record.id, { hash, vector });
  return vector;
}

/**
 * Vector ベースの非同期検索。
 * - SF_AI_VECTOR_BACKEND=tfidf (既定): 既存同期 TF-IDF と同じ挙動
 * - SF_AI_VECTOR_BACKEND=ngram        : ローカル決定的 n-gram 埋め込み
 * - SF_AI_VECTOR_BACKEND=ollama       : Ollama /api/embeddings 経由
 *
 * @param query 検索文字列
 * @param options.limit 上位件数 (既定 10)
 * @param options.minScore cosine 類似度下限 (既定 0.0、negative は除外)
 */
export async function searchByKeywordAsync(
  query: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<Array<MemoryRecord & { score?: number }>> {
  if (records.length === 0 || query.trim().length === 0) return [];

  const backend = getVectorBackend();
  if (!backend) {
    // tfidf fallback (sync), score は付与しない
    return searchByKeyword(query);
  }

  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 0;
  const queryVec = await backend.embed(query);
  const scored: Array<{ record: MemoryRecord; score: number }> = [];
  for (const record of records) {
    const recVec = await getRecordVector(backend, record);
    const score = cosineSimilarity(queryVec, recVec);
    if (score > minScore) scored.push({ record, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  for (const entry of top) touchRecordById(entry.record.id);
  if (top.length > 0) saveToDisk();
  return top.map((entry) => ({ ...entry.record, score: entry.score }));
}

/** テスト用: vector backend キャッシュをリセット */
export function resetVectorBackendForTest(): void {
  vectorBackend = null;
  vectorBackendKind = null;
  recordVectorCache.clear();
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createLogger } from "../mcp/core/logging/logger.js";

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

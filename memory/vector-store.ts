import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
let storageFilePath = process.env.SF_AI_VECTOR_STORE_FILE ?? DEFAULT_VECTOR_STORE_FILE;

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
  } catch {
    // 読み込み失敗時はインメモリのまま継続する。
  }
}

function saveToDisk(): void {
  try {
    mkdirSync(dirname(storageFilePath), { recursive: true });
    const payload = records.map((record) => JSON.stringify(record)).join("\n");
    writeFileSync(storageFilePath, payload.length > 0 ? `${payload}\n` : "", "utf-8");
  } catch {
    // ツール実行を落とさないため保存失敗は握りつぶす。
  }
}

loadFromDisk();

export function configureVectorStoreForTest(filePath: string): void {
  storageFilePath = filePath;
  loadFromDisk();
}

export function configureEmbeddingProviderForTest(provider: EmbeddingProvider): void {
  embeddingProvider = provider;
}

export function clearRecords(): void {
  records.length = 0;
  saveToDisk();
}

export function addRecord(record: MemoryRecord): void {
  records.push(record);
  saveToDisk();
}

export function searchByKeyword(query: string): MemoryRecord[] {
  return embeddingProvider.search(records, query);
}

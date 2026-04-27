/**
 * T-OLLAMA-02: Vector Embedding Provider abstraction
 *
 * テキスト → 数値ベクトル変換の共通インタフェース。
 * - "ngram" : 完全ローカルの TF/n-gram ハッシュベース。LLM 不要・決定的
 * - "ollama": Ollama サーバの /api/embeddings を呼び出す
 *
 * 既存の {@link memory/vector-store.ts} の `EmbeddingProvider` (records → ranked)
 * とは別レイヤ。新規埋め込みストアや A/B 比較用に独立した型を提供する。
 */

import { OllamaClient, getDefaultOllamaClient } from "./ollama-client.js";
import { readOllamaPolicy, type OllamaPolicyEnvSource } from "./ollama-health.js";

export interface VectorEmbeddingProvider {
  /** プロバイダ識別子 */
  readonly name: "ngram" | "ollama";
  /** 出力ベクトル次元 (動的なら -1) */
  readonly dimension: number;
  /** 単一テキスト埋め込み。ベクトル長は `dimension` と一致 */
  embed(text: string): Promise<number[]>;
  /** 複数テキストの埋め込み。実装は逐次でも並列でもよい */
  embedBatch(texts: ReadonlyArray<string>): Promise<number[][]>;
}

// ============================================================
// Ngram fallback provider (deterministic, LLM-free)
// ============================================================

const DEFAULT_NGRAM_DIM = 256;

function tokenizeForNgram(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\-\u3040-\u30ff\u4e00-\u9faf]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 32-bit FNV-1a (deterministic, fast, no crypto needed) */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  if (norm === 0) return vec;
  const inv = 1 / Math.sqrt(norm);
  return vec.map((v) => v * inv);
}

export interface NgramEmbeddingOptions {
  dimension?: number;
  /** unigram + bigram (n=1,2)。既定 [1, 2] */
  ngramSizes?: number[];
}

export class NgramEmbeddingProvider implements VectorEmbeddingProvider {
  readonly name = "ngram" as const;
  readonly dimension: number;
  private readonly ngramSizes: number[];

  constructor(options: NgramEmbeddingOptions = {}) {
    this.dimension = options.dimension ?? DEFAULT_NGRAM_DIM;
    const sizes = options.ngramSizes ?? [1, 2];
    this.ngramSizes = sizes.filter((n) => n >= 1).sort((a, b) => a - b);
    if (this.ngramSizes.length === 0) this.ngramSizes.push(1);
  }

  async embed(text: string): Promise<number[]> {
    const tokens = tokenizeForNgram(text);
    const vec = new Array<number>(this.dimension).fill(0);
    if (tokens.length === 0) return vec;

    let totalCount = 0;
    for (const n of this.ngramSizes) {
      if (tokens.length < n) continue;
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const gram = tokens.slice(i, i + n).join("\u0001");
        const idx = fnv1a(`${n}:${gram}`) % this.dimension;
        vec[idx] += 1;
        totalCount += 1;
      }
    }
    if (totalCount === 0) return vec;
    // term-frequency normalize then L2-normalize for cosine compatibility
    for (let i = 0; i < vec.length; i += 1) vec[i] /= totalCount;
    return l2Normalize(vec);
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ============================================================
// Ollama provider (live LLM-backed)
// ============================================================

export interface OllamaEmbeddingOptions {
  client?: OllamaClient;
  model?: string;
  /** バッチ並列度。既定 4 */
  concurrency?: number;
  /** 失敗時に ngram へ降格する場合のフォールバック */
  fallback?: VectorEmbeddingProvider;
}

export class OllamaEmbeddingProvider implements VectorEmbeddingProvider {
  readonly name = "ollama" as const;
  /** 動的次元 (初回 embed で確定) */
  dimension: number;
  private readonly client: OllamaClient;
  private readonly model: string;
  private readonly concurrency: number;
  private readonly fallback?: VectorEmbeddingProvider;

  constructor(options: OllamaEmbeddingOptions = {}) {
    this.client = options.client ?? getDefaultOllamaClient();
    this.model = options.model ?? "nomic-embed-text";
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    if (options.fallback) this.fallback = options.fallback;
    this.dimension = -1;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.embeddings({ model: this.model, prompt: text });
      const vec = res.embedding;
      if (this.dimension === -1) this.dimension = vec.length;
      return vec;
    } catch (err) {
      if (this.fallback) return this.fallback.embed(text);
      throw err;
    }
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(this.concurrency, texts.length) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= texts.length) break;
        results[i] = await this.embed(texts[i] ?? "");
      }
    });
    await Promise.all(workers);
    return results;
  }
}

// ============================================================
// Factory
// ============================================================

export interface EmbeddingFactoryOptions {
  env?: OllamaPolicyEnvSource;
  client?: OllamaClient;
  /** ollama プロバイダ生成時に使うフォールバック (既定 NgramEmbeddingProvider) */
  fallback?: VectorEmbeddingProvider;
}

/**
 * env のポリシーに基づき適切な EmbeddingProvider を生成する。
 * - EMBEDDING_PROVIDER=ollama -> OllamaEmbeddingProvider (failure 時 ngram fallback)
 * - それ以外                  -> NgramEmbeddingProvider
 */
export function createEmbeddingProvider(options: EmbeddingFactoryOptions = {}): VectorEmbeddingProvider {
  const policy = readOllamaPolicy(options.env ?? process.env);
  const ngram = options.fallback ?? new NgramEmbeddingProvider();
  if (policy.embeddingProvider === "ollama") {
    const ollamaOptions: OllamaEmbeddingOptions = {
      model: policy.embeddingModel,
      fallback: policy.required ? undefined : ngram
    };
    if (options.client !== undefined) ollamaOptions.client = options.client;
    return new OllamaEmbeddingProvider(ollamaOptions);
  }
  return ngram;
}

// ============================================================
// Cosine similarity helper (provider-agnostic)
// ============================================================

export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

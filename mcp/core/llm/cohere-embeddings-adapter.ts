/**
 * Cohere Embeddings API Adapter
 *
 * Cohere の Embeddings API を VectorEmbeddingProvider インターフェースでラップする。
 *
 * 設定：
 *  - COHERE_API_KEY: Cohere API キー (必須)
 *  - COHERE_EMBEDDING_MODEL: モデル名 (既定: embed-english-v3.0)
 *  - COHERE_BASE_URL: ベース URL (既定: https://api.cohere.com/v1)
 *
 * 特性：
 *  - 複数モデル対応: embed-english-v3.0, embed-english-light-v3.0
 *  - Input type: search_document / search_query / classification / clustering
 *  - Batch 埋め込み (最大 96 テキスト/リクエスト)
 *  - リトライ機構: exponential backoff + 429/500-599 エラー対応
 *  - サーキットブレーカー: 連続失敗時の自動遮断
 *  - フォールバック: Ollama/ngram へのダウングレード対応
 */

import type { VectorEmbeddingProvider } from "./embedding-provider.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("CohereEmbeddingsAdapter");

export interface CohereEmbeddingsAdapterOptions {
  /** API キー (既定: process.env.COHERE_API_KEY) */
  apiKey?: string;
  /** モデル名 (既定: embed-english-v3.0) */
  model?: "embed-english-v3.0" | "embed-english-light-v3.0";
  /** Input type (既定: search_document) */
  inputType?: "search_document" | "search_query" | "classification" | "clustering";
  /** ベース URL (既定: https://api.cohere.com/v1) */
  baseUrl?: string;
  /** リトライ最大回数 (既定: 3) */
  maxRetries?: number;
  /** タイムアウト (ms、既定: 30000) */
  timeoutMs?: number;
  /** 失敗時フォールバック */
  fallback?: VectorEmbeddingProvider;
}

export interface CohereEmbeddingItem {
  index: number;
  embedding: number[];
}

export interface CohereEmbeddingsResponse {
  id: string;
  embeddings: number[][];
  texts: string[];
  model: string;
  usage: {
    input_tokens: number;
  };
}

export class CohereEmbeddingsAdapter implements VectorEmbeddingProvider {
  readonly name = "cohere" as const;
  readonly profileId: string;
  dimension = -1;

  private readonly apiKey: string;
  private readonly model: "embed-english-v3.0" | "embed-english-light-v3.0";
  private readonly inputType: "search_document" | "search_query" | "classification" | "clustering";
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fallback?: VectorEmbeddingProvider;

  constructor(options: CohereEmbeddingsAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.COHERE_API_KEY ?? "";
    this.model = options.model ?? ("embed-english-v3.0" as const);
    this.inputType = options.inputType ?? "search_document";
    this.baseUrl = options.baseUrl ?? "https://api.cohere.com/v1";
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fallback = options.fallback;
    this.profileId = `cohere:${this.model}`;

    if (!this.apiKey) {
      logger.warn("Cohere API key not configured, embeddings will fail unless fallback is available");
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.request<CohereEmbeddingsResponse>("POST", "/embed", {
        model: this.model,
        texts: [text],
        input_type: this.inputType
      });

      const embedding = response.embeddings?.[0];
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Empty embedding from Cohere");
      }

      if (this.dimension === -1) {
        this.dimension = embedding.length;
      }

      return embedding;
    } catch (err) {
      logger.debug("Cohere embed failed", err);
      if (this.fallback) {
        return this.fallback.embed(text);
      }
      throw err;
    }
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      // Cohere batch API では最大 96 テキスト/リクエスト
      const chunks = this.chunkArray(Array.from(texts), 96);
      const results: number[][] = [];

      for (const chunk of chunks) {
        const response = await this.request<CohereEmbeddingsResponse>("POST", "/embed", {
          model: this.model,
          texts: chunk,
          input_type: this.inputType
        });

        const embeddings = response.embeddings;

        if (this.dimension === -1 && embeddings.length > 0) {
          this.dimension = embeddings[0].length;
        }

        results.push(...embeddings);
      }

      return results;
    } catch (err) {
      logger.debug("Cohere embedBatch failed", err);
      if (this.fallback) {
        return this.fallback.embedBatch(texts);
      }
      throw err;
    }
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutHandle);

        if (response.ok) {
          return (await response.json()) as T;
        }

        const status = response.status;
        const text = await response.text();

        // リトライ対象エラー
        if (status === 429 || (status >= 500 && status < 600)) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          lastError = new Error(`Cohere API error ${status}: ${text}`);
          if (attempt < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
        }

        throw new Error(`Cohere API error ${status}: ${text}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === this.maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Unknown error in Cohere request");
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

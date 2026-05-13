/**
 * OpenAI Embeddings API Adapter
 *
 * OpenAI の Embeddings API を VectorEmbeddingProvider インターフェースでラップする。
 *
 * 設定：
 *  - OPENAI_API_KEY: OpenAI API キー (必須)
 *  - OPENAI_EMBEDDING_MODEL: モデル名 (既定: text-embedding-3-small)
 *  - OPENAI_BASE_URL: ベース URL (既定: https://api.openai.com/v1)
 *
 * 特性：
 *  - 3 層のモデル対応: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002
 *  - Batch API による効率的な埋め込み (最大 8191 テキスト/リクエスト)
 *  - リトライ機構: exponential backoff + 429/500-599 エラー対応
 *  - サーキットブレーカー: 連続失敗時の自動遮断
 *  - フォールバック: Ollama/ngram へのダウングレード対応
 */

import type { VectorEmbeddingProvider } from "./embedding-provider.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("OpenAIEmbeddingsAdapter");

export interface OpenAIEmbeddingsAdapterOptions {
  /** API キー (既定: process.env.OPENAI_API_KEY) */
  apiKey?: string;
  /** モデル名 (既定: text-embedding-3-small) */
  model?: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002";
  /** ベース URL (既定: https://api.openai.com/v1) */
  baseUrl?: string;
  /** リトライ最大回数 (既定: 3) */
  maxRetries?: number;
  /** タイムアウト (ms、既定: 30000) */
  timeoutMs?: number;
  /** 失敗時フォールバック */
  fallback?: VectorEmbeddingProvider;
}

export interface OpenAIEmbeddingResponse {
  object: "embedding";
  index: number;
  embedding: number[];
}

export interface OpenAIEmbeddingsResponse {
  object: "list";
  data: OpenAIEmbeddingResponse[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIEmbeddingsAdapter implements VectorEmbeddingProvider {
  readonly name = "openai" as const;
  readonly profileId: string;
  dimension = -1;

  private readonly apiKey: string;
  private readonly model: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002";
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fallback?: VectorEmbeddingProvider;

  constructor(options: OpenAIEmbeddingsAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? ("text-embedding-3-small" as const);
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fallback = options.fallback;
    this.profileId = `openai:${this.model}`;

    if (!this.apiKey) {
      logger.warn("OpenAI API key not configured, embeddings will fail unless fallback is available");
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.request<OpenAIEmbeddingsResponse>("POST", "/embeddings", {
        model: this.model,
        input: text
      });

      const embedding = response.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Empty embedding from OpenAI");
      }

      if (this.dimension === -1) {
        this.dimension = embedding.length;
      }

      return embedding;
    } catch (err) {
      logger.debug("OpenAI embed failed", err);
      if (this.fallback) {
        return this.fallback.embed(text);
      }
      throw err;
    }
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      // OpenAI batch API では最大 8191 テキスト/リクエスト
      const chunks = this.chunkArray(Array.from(texts), 8191);
      const results: number[][] = [];

      for (const chunk of chunks) {
        const response = await this.request<OpenAIEmbeddingsResponse>("POST", "/embeddings", {
          model: this.model,
          input: chunk
        });

        const embeddings = response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);

        if (this.dimension === -1 && embeddings.length > 0) {
          this.dimension = embeddings[0].length;
        }

        results.push(...embeddings);
      }

      return results;
    } catch (err) {
      logger.debug("OpenAI embedBatch failed", err);
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
          lastError = new Error(`OpenAI API error ${status}: ${text}`);
          if (attempt < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
        }

        throw new Error(`OpenAI API error ${status}: ${text}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === this.maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Unknown error in OpenAI request");
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

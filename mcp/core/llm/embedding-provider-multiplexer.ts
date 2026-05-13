/**
 * Embedding Provider Multiplexer
 *
 * 複数のプロバイダー（Ollama、OpenAI、Cohere、ngram）を統一インターフェースで管理し、
 * 環境変数 SF_AI_EMBEDDING_PROVIDER に基づいて実行時に切り替える。
 *
 * 環境変数：
 *  - SF_AI_EMBEDDING_PROVIDER: ollama | openai | cohere | ngram (既定: ngram)
 *  - OPENAI_API_KEY: OpenAI API キー (SF_AI_EMBEDDING_PROVIDER=openai 時)
 *  - COHERE_API_KEY: Cohere API キー (SF_AI_EMBEDDING_PROVIDER=cohere 時)
 *  - EMBEDDING_PROVIDER: レガシー env (互換性維持)
 *
 * 優先度：
 *  1. SF_AI_EMBEDDING_PROVIDER (新規推奨)
 *  2. EMBEDDING_PROVIDER (レガシー)
 *  3. ngram (フォールバック)
 */

import type { VectorEmbeddingProvider } from "./embedding-provider.js";
import { NgramEmbeddingProvider, OllamaEmbeddingProvider, createEmbeddingProvider } from "./embedding-provider.js";
import { OpenAIEmbeddingsAdapter } from "./openai-embeddings-adapter.js";
import { CohereEmbeddingsAdapter } from "./cohere-embeddings-adapter.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("EmbeddingProviderMultiplexer");

export type EmbeddingProviderType = "ollama" | "openai" | "cohere" | "ngram";

export interface EmbeddingProviderMultiplexerOptions {
  provider?: EmbeddingProviderType;
  env?: Record<string, string | undefined>;
  fallback?: VectorEmbeddingProvider;
  openaiApiKey?: string;
  openaiModel?: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002";
  cohereApiKey?: string;
  cohereModel?: "embed-english-v3.0" | "embed-english-light-v3.0";
  cohereInputType?: "search_document" | "search_query" | "classification" | "clustering";
}

/**
 * 環境変数から埋め込みプロバイダータイプを判定
 */
export function resolveEmbeddingProviderType(env: Record<string, string | undefined> = process.env): EmbeddingProviderType {
  const explicit = env.SF_AI_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "cohere" || explicit === "ollama" || explicit === "ngram") {
    return explicit;
  }

  // レガシー互換性
  const legacy = env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (legacy === "ollama" || legacy === "cohere" || legacy === "openai") {
    return legacy;
  }

  return "ngram"; // デフォルト
}

/**
 * マルチプレクサー：環境に応じて最適なプロバイダーを作成・返却
 */
export function createEmbeddingProviderMultiplexer(
  options: EmbeddingProviderMultiplexerOptions = {}
): VectorEmbeddingProvider {
  const env = options.env ?? process.env;
  const providerType = options.provider ?? resolveEmbeddingProviderType(env);

  logger.debug(`Creating embedding provider: ${providerType}`);

  // フォールバック: ngram
  const defaultFallback = options.fallback ?? new NgramEmbeddingProvider();

  switch (providerType) {
    case "openai": {
      const apiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
      if (!apiKey) {
        logger.warn("OpenAI API key not configured, falling back to ngram");
        return defaultFallback;
      }
      return new OpenAIEmbeddingsAdapter({
        apiKey,
        model: options.openaiModel,
        fallback: defaultFallback
      });
    }

    case "cohere": {
      const apiKey = options.cohereApiKey ?? env.COHERE_API_KEY;
      if (!apiKey) {
        logger.warn("Cohere API key not configured, falling back to ngram");
        return defaultFallback;
      }
      return new CohereEmbeddingsAdapter({
        apiKey,
        model: options.cohereModel,
        inputType: options.cohereInputType,
        fallback: defaultFallback
      });
    }

    case "ollama": {
      return createEmbeddingProvider({
        env,
        fallback: defaultFallback
      });
    }

    case "ngram":
    default: {
      return new NgramEmbeddingProvider();
    }
  }
}

/**
 * グローバルプロバイダーキャッシュ
 */
let globalProvider: VectorEmbeddingProvider | null = null;

/**
 * グローバルな埋め込みプロバイダーを取得（キャッシュあり）
 */
export function getGlobalEmbeddingProvider(): VectorEmbeddingProvider {
  if (!globalProvider) {
    globalProvider = createEmbeddingProviderMultiplexer();
  }
  return globalProvider;
}

/**
 * グローバルプロバイダーをリセット（テスト用）
 */
export function _resetGlobalEmbeddingProviderForTest(): void {
  globalProvider = null;
}

/**
 * グローバルプロバイダーを設定（テスト用）
 */
export function _setGlobalEmbeddingProviderForTest(provider: VectorEmbeddingProvider): void {
  globalProvider = provider;
}

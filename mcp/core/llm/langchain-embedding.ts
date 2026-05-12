import { OllamaEmbeddings } from "@langchain/ollama";
import type { VectorEmbeddingProvider } from "./embedding-provider.js";
import { circuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { bulkheadRegistry, DEFAULT_OLLAMA_CONCURRENCY } from "../reliability/bulkhead.js";
import { getLangChainEmbeddingModel, getOllamaBaseUrl } from "../config/runtime-config.js";

export interface LangChainEmbeddingProviderOptions {
  model?: string;
  baseUrl?: string;
}

export class LangChainEmbeddingProvider implements VectorEmbeddingProvider {
  readonly name = "ollama" as const;
  dimension = -1;

  private readonly embeddings: OllamaEmbeddings;
  private readonly circuitBreaker = circuitBreakerRegistry.get("ollama-embeddings", {
    failureRateThreshold: 0.5,
    minCallsInWindow: 3,
    cooldownMs: 10_000,
    windowSize: 10,
    halfOpenSuccessThreshold: 1
  });
  private readonly bulkhead = bulkheadRegistry.get("ollama-embeddings", {
    concurrency: DEFAULT_OLLAMA_CONCURRENCY,
    maxQueue: 30
  });

  constructor(options: LangChainEmbeddingProviderOptions = {}) {
    this.embeddings = new OllamaEmbeddings({
      model: options.model ?? getLangChainEmbeddingModel("nomic-embed-text"),
      baseUrl: options.baseUrl ?? getOllamaBaseUrl()
    });
  }

  async embed(text: string): Promise<number[]> {
    const vector = await this.bulkhead.execute(async () =>
      this.circuitBreaker.execute(async () => this.embeddings.embedQuery(text))
    );
    if (this.dimension === -1) {
      this.dimension = vector.length;
    }
    return vector;
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    const vectors = await this.bulkhead.execute(async () =>
      this.circuitBreaker.execute(async () => this.embeddings.embedDocuments([...texts]))
    );
    if (this.dimension === -1 && vectors.length > 0) {
      this.dimension = vectors[0]?.length ?? -1;
    }
    return vectors;
  }
}

let DEFAULT_PROVIDER: LangChainEmbeddingProvider | null = null;

export function getDefaultLangChainEmbeddingProvider(): LangChainEmbeddingProvider {
  if (!DEFAULT_PROVIDER) {
    DEFAULT_PROVIDER = new LangChainEmbeddingProvider();
  }
  return DEFAULT_PROVIDER;
}

export function _setDefaultLangChainEmbeddingProviderForTest(provider: LangChainEmbeddingProvider | null): void {
  DEFAULT_PROVIDER = provider;
}

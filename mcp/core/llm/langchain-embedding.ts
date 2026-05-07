import { OllamaEmbeddings } from "@langchain/ollama";
import type { VectorEmbeddingProvider } from "./embedding-provider.js";

export interface LangChainEmbeddingProviderOptions {
  model?: string;
  baseUrl?: string;
}

export class LangChainEmbeddingProvider implements VectorEmbeddingProvider {
  readonly name = "ollama" as const;
  dimension = -1;

  private readonly embeddings: OllamaEmbeddings;

  constructor(options: LangChainEmbeddingProviderOptions = {}) {
    this.embeddings = new OllamaEmbeddings({
      model: options.model ?? process.env.SF_AI_LANGCHAIN_EMBEDDING_MODEL ?? "nomic-embed-text",
      baseUrl: options.baseUrl ?? process.env.OLLAMA_BASE_URL
    });
  }

  async embed(text: string): Promise<number[]> {
    const vector = await this.embeddings.embedQuery(text);
    if (this.dimension === -1) {
      this.dimension = vector.length;
    }
    return vector;
  }

  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    const vectors = await this.embeddings.embedDocuments([...texts]);
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

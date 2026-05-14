export interface LlmCacheUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmCacheEntry {
  cacheKey: string;
  promptHash: string;
  adapter: string;
  version: string;
  model?: string;
  paramsHash: string;
  outputText: string;
  usage?: LlmCacheUsage;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LlmCacheLookupInput {
  cacheKey: string;
}

export interface LlmCacheStoreInput {
  cacheKey: string;
  promptHash: string;
  adapter: string;
  version: string;
  model?: string;
  paramsHash: string;
  outputText: string;
  usage?: LlmCacheUsage;
  metadata?: Record<string, unknown>;
}

export interface LlmCacheStorePort {
  get(input: LlmCacheLookupInput): Promise<LlmCacheEntry | null>;
  set(input: LlmCacheStoreInput): Promise<void>;
  close(): Promise<void>;
}

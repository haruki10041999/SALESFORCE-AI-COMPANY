/**
 * TASK-03: Embedding Provider Multiplexer Integration Tests
 *
 * Verify:
 *  1. Provider selection from environment variables
 *  2. Fallback mechanisms (API key validation, error handling)
 *  3. Batch embedding support for each provider
 *  4. OpenAI and Cohere adapter functionality
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmbeddingProviderMultiplexer,
  resolveEmbeddingProviderType,
  getGlobalEmbeddingProvider,
  _resetGlobalEmbeddingProviderForTest,
  _setGlobalEmbeddingProviderForTest
} from "../mcp/core/llm/embedding-provider-multiplexer.js";
import { OpenAIEmbeddingsAdapter } from "../mcp/core/llm/openai-embeddings-adapter.js";
import { CohereEmbeddingsAdapter } from "../mcp/core/llm/cohere-embeddings-adapter.js";
import { NgramEmbeddingProvider } from "../mcp/core/llm/embedding-provider.js";

test("TASK-03: resolveEmbeddingProviderType - defaults to ngram", () => {
  const result = resolveEmbeddingProviderType({});
  assert.equal(result, "ngram");
});

test("TASK-03: resolveEmbeddingProviderType - respects SF_AI_EMBEDDING_PROVIDER", () => {
  const result = resolveEmbeddingProviderType({ SF_AI_EMBEDDING_PROVIDER: "openai" });
  assert.equal(result, "openai");
});

test("TASK-03: resolveEmbeddingProviderType - supports all provider types", () => {
  const providers = ["ollama", "openai", "cohere", "ngram"] as const;
  for (const provider of providers) {
    const result = resolveEmbeddingProviderType({ SF_AI_EMBEDDING_PROVIDER: provider });
    assert.equal(result, provider);
  }
});

test("TASK-03: resolveEmbeddingProviderType - case-insensitive", () => {
  const result = resolveEmbeddingProviderType({ SF_AI_EMBEDDING_PROVIDER: "OPENAI" });
  assert.equal(result, "openai");
});

test("TASK-03: resolveEmbeddingProviderType - prefers SF_AI_EMBEDDING_PROVIDER over EMBEDDING_PROVIDER", () => {
  const result = resolveEmbeddingProviderType({
    SF_AI_EMBEDDING_PROVIDER: "cohere",
    EMBEDDING_PROVIDER: "ollama"
  });
  assert.equal(result, "cohere");
});

test("TASK-03: createEmbeddingProviderMultiplexer - returns ngram by default", () => {
  const provider = createEmbeddingProviderMultiplexer({ env: {} });
  assert.equal(provider.name, "ngram");
});

test("TASK-03: createEmbeddingProviderMultiplexer - creates OpenAI adapter with API key", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "openai",
    openaiApiKey: "test-key"
  });
  assert.ok(provider instanceof OpenAIEmbeddingsAdapter);
});

test("TASK-03: createEmbeddingProviderMultiplexer - falls back to ngram when OpenAI API key missing", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "openai",
    env: {}
  });
  assert.equal(provider.name, "ngram");
});

test("TASK-03: createEmbeddingProviderMultiplexer - creates Cohere adapter with API key", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "cohere",
    cohereApiKey: "test-key"
  });
  assert.ok(provider instanceof CohereEmbeddingsAdapter);
});

test("TASK-03: createEmbeddingProviderMultiplexer - falls back to ngram when Cohere API key missing", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "cohere",
    env: {}
  });
  assert.equal(provider.name, "ngram");
});

test("TASK-03: createEmbeddingProviderMultiplexer - passes model option to OpenAI", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "openai",
    openaiApiKey: "test-key",
    openaiModel: "text-embedding-3-large"
  });
  assert.ok(provider instanceof OpenAIEmbeddingsAdapter);
  assert.equal(provider.profileId, "openai:text-embedding-3-large");
});

test("TASK-03: createEmbeddingProviderMultiplexer - passes model option to Cohere", () => {
  const provider = createEmbeddingProviderMultiplexer({
    provider: "cohere",
    cohereApiKey: "test-key",
    cohereModel: "embed-english-light-v3.0"
  });
  assert.ok(provider instanceof CohereEmbeddingsAdapter);
  assert.equal(provider.profileId, "cohere:embed-english-light-v3.0");
});

test("TASK-03: OpenAIEmbeddingsAdapter - has correct profileId", () => {
  const adapter = new OpenAIEmbeddingsAdapter({
    apiKey: "test-key",
    model: "text-embedding-3-small"
  });
  assert.ok(adapter.profileId.startsWith("openai:"));
});

test("TASK-03: OpenAIEmbeddingsAdapter - dimension is -1 before first embed", () => {
  const adapter = new OpenAIEmbeddingsAdapter({
    apiKey: "test-key"
  });
  assert.equal(adapter.dimension, -1);
});

test("TASK-03: CohereEmbeddingsAdapter - has correct profileId", () => {
  const adapter = new CohereEmbeddingsAdapter({
    apiKey: "test-key",
    model: "embed-english-v3.0"
  });
  assert.ok(adapter.profileId.startsWith("cohere:"));
});

test("TASK-03: CohereEmbeddingsAdapter - dimension is -1 before first embed", () => {
  const adapter = new CohereEmbeddingsAdapter({
    apiKey: "test-key"
  });
  assert.equal(adapter.dimension, -1);
});

test("TASK-03: getGlobalEmbeddingProvider - returns cached provider", () => {
  _resetGlobalEmbeddingProviderForTest();
  const first = getGlobalEmbeddingProvider();
  const second = getGlobalEmbeddingProvider();
  assert.strictEqual(first, second);
});

test("TASK-03: getGlobalEmbeddingProvider - can be mocked for tests", () => {
  _resetGlobalEmbeddingProviderForTest();
  const mockProvider = new NgramEmbeddingProvider({ dimension: 128 });
  _setGlobalEmbeddingProviderForTest(mockProvider);
  
  const provider = getGlobalEmbeddingProvider();
  assert.strictEqual(provider, mockProvider);
  assert.equal(provider.dimension, 128);
  
  _resetGlobalEmbeddingProviderForTest();
});

test("TASK-03: createEmbeddingProviderMultiplexer - respects env.SF_AI_EMBEDDING_PROVIDER", () => {
  const provider = createEmbeddingProviderMultiplexer({
    env: {
      SF_AI_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key"
    }
  });
  assert.ok(provider instanceof OpenAIEmbeddingsAdapter);
});

test("TASK-03: createEmbeddingProviderMultiplexer - respects env.COHERE_API_KEY", () => {
  const provider = createEmbeddingProviderMultiplexer({
    env: {
      SF_AI_EMBEDDING_PROVIDER: "cohere",
      COHERE_API_KEY: "test-key"
    }
  });
  assert.ok(provider instanceof CohereEmbeddingsAdapter);
});

test("TASK-03: Multiplexer supports fallback provider", () => {
  const fallback = new NgramEmbeddingProvider({ dimension: 64 });
  const provider = createEmbeddingProviderMultiplexer({
    provider: "openai",
    fallback
  });
  // When API key is missing, should return the fallback
  assert.strictEqual(provider, fallback);
});

test("TASK-03: OpenAI and Cohere adapters have proper names", () => {
  const openai = new OpenAIEmbeddingsAdapter({ apiKey: "test" });
  const cohere = new CohereEmbeddingsAdapter({ apiKey: "test" });
  
  assert.equal(openai.name, "openai");
  assert.equal(cohere.name, "cohere");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  NgramEmbeddingProvider,
  OllamaEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity
} from "../mcp/core/llm/embedding-provider.js";
import { OllamaClient, OllamaError } from "../mcp/core/llm/ollama-client.js";

function fixedClient(embedding: number[]): OllamaClient {
  const fakeFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ embedding }),
    text: async () => ""
  } as unknown as Response)) as unknown as typeof fetch;
  return new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
}

function failingClient(): OllamaClient {
  const fakeFetch = (async () => {
    throw new OllamaError("E_OLLAMA_NETWORK", "down", { retriable: true });
  }) as unknown as typeof fetch;
  return new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
}

test("NgramEmbeddingProvider: dimension matches option", async () => {
  const p = new NgramEmbeddingProvider({ dimension: 64 });
  const v = await p.embed("hello world");
  assert.equal(p.dimension, 64);
  assert.equal(v.length, 64);
});

test("NgramEmbeddingProvider: empty text returns zero vector", async () => {
  const p = new NgramEmbeddingProvider({ dimension: 16 });
  const v = await p.embed("");
  assert.equal(v.length, 16);
  assert.ok(v.every((x) => x === 0));
});

test("NgramEmbeddingProvider: same text deterministic", async () => {
  const p = new NgramEmbeddingProvider();
  const a = await p.embed("salesforce trigger");
  const b = await p.embed("salesforce trigger");
  assert.deepEqual(a, b);
});

test("NgramEmbeddingProvider: similar texts have higher cosine than dissimilar", async () => {
  const p = new NgramEmbeddingProvider({ dimension: 512 });
  const a = await p.embed("apex trigger pattern review");
  const b = await p.embed("apex trigger best practices review");
  const c = await p.embed("flow approval routing config");
  const sim_ab = cosineSimilarity(a, b);
  const sim_ac = cosineSimilarity(a, c);
  assert.ok(sim_ab > sim_ac, `sim_ab=${sim_ab} should be > sim_ac=${sim_ac}`);
});

test("NgramEmbeddingProvider: l2-normalized vector has unit norm", async () => {
  const p = new NgramEmbeddingProvider();
  const v = await p.embed("hello world apex");
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
});

test("NgramEmbeddingProvider: embedBatch returns same length as input", async () => {
  const p = new NgramEmbeddingProvider();
  const r = await p.embedBatch(["a", "b", "c"]);
  assert.equal(r.length, 3);
});

test("OllamaEmbeddingProvider: returns embedding from server", async () => {
  const p = new OllamaEmbeddingProvider({ client: fixedClient([0.1, 0.2, 0.3]), model: "x" });
  const v = await p.embed("hello");
  assert.deepEqual(v, [0.1, 0.2, 0.3]);
  assert.equal(p.dimension, 3);
});

test("OllamaEmbeddingProvider: falls back to ngram on failure when fallback set", async () => {
  const ngram = new NgramEmbeddingProvider({ dimension: 32 });
  const p = new OllamaEmbeddingProvider({ client: failingClient(), model: "x", fallback: ngram });
  const v = await p.embed("hello");
  assert.equal(v.length, 32);
});

test("OllamaEmbeddingProvider: throws when no fallback configured", async () => {
  const p = new OllamaEmbeddingProvider({ client: failingClient(), model: "x" });
  await assert.rejects(() => p.embed("hello"));
});

test("OllamaEmbeddingProvider: embedBatch respects concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const fakeFetch = (async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
    return { ok: true, status: 200, json: async () => ({ embedding: [1] }), text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
  const client = new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
  const p = new OllamaEmbeddingProvider({ client, model: "x", concurrency: 3 });
  await p.embedBatch(Array.from({ length: 10 }, (_, i) => String(i)));
  assert.ok(peak <= 3, `peak=${peak} exceeded concurrency`);
});

test("createEmbeddingProvider: defaults to ngram", () => {
  const p = createEmbeddingProvider({ env: {} });
  assert.equal(p.name, "ngram");
});

test("createEmbeddingProvider: returns ollama when EMBEDDING_PROVIDER=ollama", () => {
  const p = createEmbeddingProvider({
    env: { EMBEDDING_PROVIDER: "ollama" },
    client: fixedClient([1, 2])
  });
  assert.equal(p.name, "ollama");
});

test("createEmbeddingProvider: ollama+required=true has no fallback", async () => {
  const p = createEmbeddingProvider({
    env: { EMBEDDING_PROVIDER: "ollama", OLLAMA_REQUIRED: "true" },
    client: failingClient()
  });
  await assert.rejects(() => p.embed("x"));
});

test("createEmbeddingProvider: ollama+optional uses ngram fallback", async () => {
  const p = createEmbeddingProvider({
    env: { EMBEDDING_PROVIDER: "ollama", OLLAMA_REQUIRED: "false" },
    client: failingClient()
  });
  const v = await p.embed("hello");
  assert.ok(v.length > 0);
});

test("cosineSimilarity: identical vectors -> 1", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

test("cosineSimilarity: orthogonal -> 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: zero vector -> 0", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

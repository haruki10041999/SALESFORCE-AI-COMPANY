import test from "node:test";
import assert from "node:assert/strict";

import {
  OllamaClient
} from "../mcp/core/llm/ollama-client.js";
import {
  checkOllamaAvailability,
  decideFallback,
  evaluateOllamaStartup,
  readOllamaPolicy,
  _resetOllamaHealthCache
} from "../mcp/core/llm/ollama-health.js";

function makeClient(responses: Array<{ ok: boolean; models?: string[]; error?: string }>): OllamaClient {
  let i = 0;
  const fakeFetch = (async () => {
    const r = responses[i++];
    if (!r) throw new Error("no more responses");
    if (!r.ok) throw new Error(r.error ?? "down");
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: (r.models ?? []).map((n) => ({ name: n, modified_at: "x", size: 0 })) }),
      text: async () => ""
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
}

test("readOllamaPolicy: defaults are ngram + nomic-embed-text + qwen2.5:3b", () => {
  const p = readOllamaPolicy({});
  assert.equal(p.required, false);
  assert.equal(p.embeddingProvider, "ngram");
  assert.equal(p.embeddingModel, "nomic-embed-text");
  assert.equal(p.judgeModel, "qwen2.5:3b");
});

test("readOllamaPolicy: respects OLLAMA_REQUIRED=true and EMBEDDING_PROVIDER=ollama", () => {
  const p = readOllamaPolicy({
    OLLAMA_REQUIRED: "TRUE",
    EMBEDDING_PROVIDER: "ollama",
    OLLAMA_EMBEDDING_MODEL: "custom-embed"
  });
  assert.equal(p.required, true);
  assert.equal(p.embeddingProvider, "ollama");
  assert.equal(p.embeddingModel, "custom-embed");
});

test("checkOllamaAvailability: returns available with models", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: true, models: ["nomic-embed-text", "qwen2.5:3b"] }]);
  const a = await checkOllamaAvailability({ client, force: true });
  assert.equal(a.status, "available");
  if (a.status === "available") {
    assert.deepEqual(a.models, ["nomic-embed-text", "qwen2.5:3b"]);
  }
});

test("checkOllamaAvailability: unavailable when server is down", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: false, error: "ECONNREFUSED" }]);
  const a = await checkOllamaAvailability({ client, force: true });
  assert.equal(a.status, "unavailable");
});

test("checkOllamaAvailability: required models missing -> unavailable", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: true, models: ["llama3"] }]);
  const a = await checkOllamaAvailability({
    client,
    force: true,
    requiredModels: ["nomic-embed-text"]
  });
  assert.equal(a.status, "unavailable");
  if (a.status === "unavailable") {
    assert.match(a.reason, /nomic-embed-text/);
  }
});

test("checkOllamaAvailability: cache reuses result within TTL", async () => {
  _resetOllamaHealthCache();
  let calls = 0;
  const fakeFetch = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
      text: async () => ""
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const client = new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
  await checkOllamaAvailability({ client, force: true, cacheTtlMs: 60000 });
  await checkOllamaAvailability({ client, cacheTtlMs: 60000 });
  await checkOllamaAvailability({ client, cacheTtlMs: 60000 });
  assert.equal(calls, 1);
});

test("decideFallback: required + unavailable -> abort-startup", () => {
  const d = decideFallback(
    { required: true, embeddingProvider: "ollama", embeddingModel: "x", judgeModel: "y" },
    { status: "unavailable", reason: "down", checkedAt: 0 }
  );
  assert.equal(d.kind, "abort-startup");
});

test("decideFallback: optional + unavailable -> fallback-ngram", () => {
  const d = decideFallback(
    { required: false, embeddingProvider: "ollama", embeddingModel: "x", judgeModel: "y" },
    { status: "unavailable", reason: "down", checkedAt: 0 }
  );
  assert.equal(d.kind, "fallback-ngram");
});

test("decideFallback: provider=ollama + available -> use-ollama", () => {
  const d = decideFallback(
    { required: false, embeddingProvider: "ollama", embeddingModel: "x", judgeModel: "y" },
    { status: "available", models: ["x"], checkedAt: 0 }
  );
  assert.equal(d.kind, "use-ollama");
});

test("decideFallback: provider=ngram -> always fallback-ngram", () => {
  const d = decideFallback(
    { required: false, embeddingProvider: "ngram", embeddingModel: "x", judgeModel: "y" },
    { status: "available", models: ["x"], checkedAt: 0 }
  );
  assert.equal(d.kind, "fallback-ngram");
});

test("evaluateOllamaStartup: combines policy/availability/decision (provider=ngram)", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: true, models: [] }]);
  const r = await evaluateOllamaStartup({ env: {}, client, force: true });
  assert.equal(r.policy.embeddingProvider, "ngram");
  assert.equal(r.decision.kind, "fallback-ngram");
});

test("evaluateOllamaStartup: provider=ollama + missing model + required=true -> abort", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: true, models: ["unrelated"] }]);
  const r = await evaluateOllamaStartup({
    env: { EMBEDDING_PROVIDER: "ollama", OLLAMA_REQUIRED: "true" },
    client,
    force: true
  });
  assert.equal(r.decision.kind, "abort-startup");
});

test("evaluateOllamaStartup: provider=ollama + model present -> use-ollama", async () => {
  _resetOllamaHealthCache();
  const client = makeClient([{ ok: true, models: ["nomic-embed-text"] }]);
  const r = await evaluateOllamaStartup({
    env: { EMBEDDING_PROVIDER: "ollama" },
    client,
    force: true
  });
  assert.equal(r.decision.kind, "use-ollama");
});

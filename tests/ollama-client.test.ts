import test from "node:test";
import assert from "node:assert/strict";

import {
  OllamaClient,
  OllamaError,
  buildOllamaClientFromEnv
} from "../mcp/core/llm/ollama-client.js";

interface MockResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

function mockFetch(responses: MockResponse[] | ((url: string, init?: RequestInit) => Promise<MockResponse> | MockResponse)): {
  fn: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (typeof responses === "function") {
      return await responses(url, init);
    }
    const res = responses[i++];
    if (!res) throw new Error("mockFetch: no more responses");
    return {
      ok: res.ok,
      status: res.status,
      json: res.json ?? (async () => ({})),
      text: res.text ?? (async () => "")
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("ollama-client: listModels parses /api/tags", async () => {
  const { fn } = mockFetch([
    {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "qwen2.5:3b", modified_at: "x", size: 100 }] })
    }
  ]);
  const client = new OllamaClient({ fetchImpl: fn });
  const tags = await client.listModels();
  assert.equal(tags.models[0]?.name, "qwen2.5:3b");
});

test("ollama-client: health returns ok:true with model list", async () => {
  const { fn } = mockFetch([
    {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "nomic-embed-text", modified_at: "x", size: 1 }] })
    }
  ]);
  const client = new OllamaClient({ fetchImpl: fn });
  const h = await client.health();
  assert.equal(h.ok, true);
  assert.deepEqual(h.models, ["nomic-embed-text"]);
});

test("ollama-client: health returns ok:false on connection error", async () => {
  const fn = (async () => {
    throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  }) as unknown as typeof fetch;
  const client = new OllamaClient({ fetchImpl: fn, maxRetries: 0 });
  const h = await client.health();
  assert.equal(h.ok, false);
  assert.ok(h.error);
});

test("ollama-client: embeddings returns embedding vector", async () => {
  const { fn } = mockFetch([
    { ok: true, status: 200, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) }
  ]);
  const client = new OllamaClient({ fetchImpl: fn });
  const r = await client.embeddings({ model: "nomic-embed-text", prompt: "hello" });
  assert.deepEqual(r.embedding, [0.1, 0.2, 0.3]);
});

test("ollama-client: embeddings throws on empty embedding", async () => {
  const { fn } = mockFetch([
    { ok: true, status: 200, json: async () => ({ embedding: [] }) }
  ]);
  const client = new OllamaClient({ fetchImpl: fn, maxRetries: 0 });
  await assert.rejects(
    () => client.embeddings({ model: "nomic-embed-text", prompt: "x" }),
    (err: unknown) => err instanceof OllamaError && err.code === "E_OLLAMA_EMPTY_EMBEDDING"
  );
});

test("ollama-client: 5xx triggers retry then succeeds", async () => {
  const { fn, calls } = mockFetch([
    { ok: false, status: 503, text: async () => "service unavailable" },
    { ok: true, status: 200, json: async () => ({ embedding: [1, 2] }) }
  ]);
  const client = new OllamaClient({ fetchImpl: fn, maxRetries: 1, retryBaseDelayMs: 1 });
  const r = await client.embeddings({ model: "m", prompt: "x" });
  assert.equal(calls.length, 2);
  assert.deepEqual(r.embedding, [1, 2]);
});

test("ollama-client: 4xx (not 408/429) does not retry", async () => {
  const { fn, calls } = mockFetch([
    { ok: false, status: 400, text: async () => "bad request" }
  ]);
  const client = new OllamaClient({ fetchImpl: fn, maxRetries: 3, retryBaseDelayMs: 1 });
  await assert.rejects(
    () => client.embeddings({ model: "m", prompt: "x" }),
    (err: unknown) => err instanceof OllamaError && err.status === 400
  );
  assert.equal(calls.length, 1);
});

test("ollama-client: timeout aborts and surfaces E_OLLAMA_TIMEOUT", async () => {
  const fn = ((url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;
  const client = new OllamaClient({ fetchImpl: fn, timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(
    () => client.listModels(),
    (err: unknown) => err instanceof OllamaError && err.code === "E_OLLAMA_TIMEOUT"
  );
});

test("ollama-client: generate calls /api/generate with stream:false", async () => {
  const { fn, calls } = mockFetch([
    { ok: true, status: 200, json: async () => ({ model: "qwen2.5:3b", response: "hi", done: true }) }
  ]);
  const client = new OllamaClient({ fetchImpl: fn });
  const r = await client.generate({ model: "qwen2.5:3b", prompt: "hello" });
  assert.equal(r.response, "hi");
  assert.equal(calls[0]?.url.endsWith("/api/generate"), true);
  const payload = JSON.parse((calls[0]?.init?.body as string) ?? "{}");
  assert.equal(payload.stream, false);
});

test("ollama-client: missing model throws E_OLLAMA_BAD_REQUEST", async () => {
  const client = new OllamaClient({ fetchImpl: (async () => undefined as unknown as Response) });
  await assert.rejects(
    () => client.embeddings({ model: "", prompt: "x" }),
    (err: unknown) => err instanceof OllamaError && err.code === "E_OLLAMA_BAD_REQUEST"
  );
});

test("ollama-client: buildOllamaClientFromEnv reads OLLAMA_BASE_URL", async () => {
  const { fn, calls } = mockFetch([
    { ok: true, status: 200, json: async () => ({ models: [] }) }
  ]);
  const client = buildOllamaClientFromEnv({ OLLAMA_BASE_URL: "http://example.com:9999/" });
  // 内部 fetch を差し替えて baseUrl 反映を確認
  (client as unknown as { fetchImpl: typeof fetch }).fetchImpl = fn;
  await client.listModels();
  assert.equal(calls[0]?.url, "http://example.com:9999/api/tags");
});

test("ollama-client: trailing slash in baseUrl is normalized", async () => {
  const { fn, calls } = mockFetch([
    { ok: true, status: 200, json: async () => ({ models: [] }) }
  ]);
  const client = new OllamaClient({ baseUrl: "http://localhost:11434///", fetchImpl: fn });
  await client.listModels();
  assert.equal(calls[0]?.url, "http://localhost:11434/api/tags");
});

// ============================================================
// T-OLLAMA-03: generateStream NDJSON streaming
// ============================================================

function makeNdjsonStreamResponse(lines: string[]): MockResponse {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    }
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
    // body は型外
    ...({ body } as unknown as object)
  };
}

test("ollama-client: generateStream aggregates NDJSON chunks and invokes onChunk", async () => {
  const lines = [
    JSON.stringify({ model: "qwen2.5:3b", response: "Hello", done: false }),
    JSON.stringify({ model: "qwen2.5:3b", response: ", ", done: false }),
    JSON.stringify({ model: "qwen2.5:3b", response: "world!", done: true, total_duration: 12345, eval_count: 7 })
  ];
  const stream = makeNdjsonStreamResponse(lines);
  const fn = (async () => stream as unknown as Response) as typeof fetch;
  const client = new OllamaClient({ baseUrl: "http://x", fetchImpl: fn });

  const collected: string[] = [];
  const final = await client.generateStream(
    { model: "qwen2.5:3b", prompt: "hi" },
    (c) => collected.push(c.response)
  );
  assert.deepEqual(collected, ["Hello", ", ", "world!"]);
  assert.equal(final.response, "Hello, world!");
  assert.equal(final.done, true);
  assert.equal(final.total_duration, 12345);
  assert.equal(final.eval_count, 7);
});

test("ollama-client: generateStream throws OllamaError on non-2xx", async () => {
  const fn = (async () => ({
    ok: false,
    status: 503,
    text: async () => "service unavailable"
  } as unknown as Response)) as typeof fetch;
  const client = new OllamaClient({ baseUrl: "http://x", fetchImpl: fn });
  await assert.rejects(
    () => client.generateStream({ model: "qwen2.5:3b", prompt: "hi" }),
    (err: unknown) => err instanceof OllamaError && err.code === "E_OLLAMA_HTTP_503"
  );
});

test("ollama-client: generateStream rejects when model is missing", async () => {
  const client = new OllamaClient({ baseUrl: "http://x" });
  await assert.rejects(
    () => client.generateStream({ model: "", prompt: "hi" }),
    (err: unknown) => err instanceof OllamaError && err.code === "E_OLLAMA_BAD_REQUEST"
  );
});



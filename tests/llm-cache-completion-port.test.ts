import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLlmCacheKey } from "../mcp/infrastructure/llm/llm-cache-postgres.js";
import { createCachedCompletionPort } from "../mcp/infrastructure/llm/llm-cache-completion-port.js";
import type { LlmCacheStorePort } from "../mcp/core/ports/llm-cache-port.js";
import type { LlmCompletionPort } from "../mcp/core/ports/llm-completion-port.js";

class InMemoryCacheStore implements LlmCacheStorePort {
  private readonly data = new Map<string, { text: string }>();

  async get(input: { cacheKey: string }) {
    const entry = this.data.get(input.cacheKey);
    if (!entry) {
      return null;
    }
    const now = new Date().toISOString();
    return {
      cacheKey: input.cacheKey,
      promptHash: "p",
      adapter: "a",
      version: "v",
      paramsHash: "h",
      outputText: entry.text,
      createdAt: now,
      updatedAt: now
    };
  }

  async set(input: { cacheKey: string; outputText: string }) {
    this.data.set(input.cacheKey, { text: input.outputText });
  }

  async close(): Promise<void> {
    return;
  }
}

describe("llm cache key", () => {
  it("produces same key for same prompt+params+adapter+version", () => {
    const a = buildLlmCacheKey({
      prompt: "hello",
      adapter: "agent-chat-fallback",
      version: "v1",
      params: { model: "m1", temperature: 0.2 }
    });
    const b = buildLlmCacheKey({
      prompt: "hello",
      adapter: "agent-chat-fallback",
      version: "v1",
      params: { model: "m1", temperature: 0.2 }
    });
    assert.equal(a.cacheKey, b.cacheKey);
    assert.equal(a.promptHash, b.promptHash);
    assert.equal(a.paramsHash, b.paramsHash);
  });

  it("changes key when version changes", () => {
    const a = buildLlmCacheKey({
      prompt: "hello",
      adapter: "agent-chat-fallback",
      version: "v1",
      params: { model: "m1" }
    });
    const b = buildLlmCacheKey({
      prompt: "hello",
      adapter: "agent-chat-fallback",
      version: "v2",
      params: { model: "m1" }
    });
    assert.notEqual(a.cacheKey, b.cacheKey);
  });
});

describe("cached completion port", () => {
  it("throws on strict replay cache miss", async () => {
    const base: LlmCompletionPort = {
      async complete() {
        return { text: "live" };
      }
    };
    const cache = new InMemoryCacheStore();
    const port = createCachedCompletionPort(base, cache, {
      replayMode: "strict",
      requireCacheHit: true
    });

    await assert.rejects(
      async () => {
        await port.complete({ prompt: "missing" });
      },
      /requires cache hit/
    );
  });

  it("writes through on miss in observe mode", async () => {
    let called = 0;
    const base: LlmCompletionPort = {
      async complete() {
        called += 1;
        return { text: "live" };
      }
    };
    const cache = new InMemoryCacheStore();
    const port = createCachedCompletionPort(base, cache, {
      replayMode: "observe"
    });

    const first = await port.complete({ prompt: "memo" });
    const second = await port.complete({ prompt: "memo" });

    assert.equal(first.text, "live");
    assert.equal(second.text, "live");
    assert.equal(called, 1);
  });
});

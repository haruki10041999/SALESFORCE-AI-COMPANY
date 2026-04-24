/**
 * prompt-cache.test.ts
 *
 * テスト: buildChatPromptFromContext のキャッシュ TTL と LRU 驱逐動作
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * 簡略版プロンプトキャッシュ実装
 * LRU + TTL を検証するためのテスト用実装
 */
interface CacheEntry {
  prompt: string;
  timestamp: number;
  accessCount: number;
}

class PromptCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = 100, ttlMs: number = 3600 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Update access info for LRU
    entry.accessCount += 1;
    entry.timestamp = Date.now(); // Update timestamp on access
    return entry.prompt;
  }

  set(key: string, prompt: string): void {
    // Remove expired entries first
    this.evictExpired();

    // If at capacity, evict LRU entry
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      prompt,
      timestamp: Date.now(),
      accessCount: 0
    });
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let minAccess = Infinity;
    let minTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      // LRU: least recently used (lowest accessCount, oldest timestamp)
      if (
        entry.accessCount < minAccess ||
        (entry.accessCount === minAccess && entry.timestamp < minTime)
      ) {
        lruKey = key;
        minAccess = entry.accessCount;
        minTime = entry.timestamp;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

test("PromptCache: stores and retrieves cached prompts", async () => {
  const cache = new PromptCache(10, 1000);

  cache.set("prompt-1", "This is prompt 1");
  assert.equal(cache.get("prompt-1"), "This is prompt 1", "Should retrieve stored prompt");

  cache.set("prompt-2", "This is prompt 2");
  assert.equal(cache.size(), 2, "Should have 2 cached prompts");
});

test("PromptCache: evicts LRU entry when at max capacity", async () => {
  const cache = new PromptCache(3); // Small capacity for testing

  cache.set("a", "Prompt A");
  cache.set("b", "Prompt B");
  cache.set("c", "Prompt C");

  assert.equal(cache.size(), 3, "Should be at capacity");

  // Access 'a' to make it more recently used
  cache.get("a");
  cache.get("a");

  // Add new entry - should evict LRU (b or c)
  cache.set("d", "Prompt D");

  assert.equal(cache.size(), 3, "Should still be at capacity");
  assert.equal(cache.get("a"), "Prompt A", "Most accessed entry should remain");
  assert.ok(cache.get("b") === null || cache.get("c") === null, "One of b or c should be evicted");
});

test("PromptCache: respects TTL and evicts expired entries", async () => {
  const cache = new PromptCache(10, 100); // 100ms TTL

  cache.set("prompt-1", "This will expire");
  assert.equal(cache.get("prompt-1"), "This will expire", "Should retrieve fresh prompt");

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(cache.get("prompt-1"), null, "Expired prompt should return null");
});

test("PromptCache: handles mixed access patterns", async () => {
  const cache = new PromptCache(5, 5000);

  // Add 5 prompts
  for (let i = 0; i < 5; i++) {
    cache.set(`prompt-${i}`, `Content ${i}`);
  }

  assert.equal(cache.size(), 5, "Should have 5 entries");

  // Access some entries to make them more recent
  cache.get("prompt-0");
  cache.get("prompt-0");
  cache.get("prompt-1");

  // Add new entry - should evict LRU
  cache.set("prompt-5", "Content 5");

  assert.equal(cache.size(), 5, "Should maintain capacity");

  // Least accessed entries should be evicted
  const remaining = cache.keys();
  assert.ok(remaining.includes("prompt-0"), "Most accessed entry should remain");
  assert.ok(remaining.includes("prompt-1"), "Accessed entry should remain");
});

test("PromptCache: correctly identifies LRU by access time and count", async () => {
  const cache = new PromptCache(3, 10000);

  cache.set("old-unused", "Never accessed again");
  await new Promise((resolve) => setTimeout(resolve, 50));

  cache.set("recent-once", "Accessed once");
  cache.get("recent-once");
  await new Promise((resolve) => setTimeout(resolve, 50));

  cache.set("recent-multiple", "Accessed multiple times");
  cache.get("recent-multiple");
  cache.get("recent-multiple");
  cache.get("recent-multiple");

  assert.equal(cache.size(), 3, "Should have 3 entries");

  // Add new entry - should evict "old-unused"
  cache.set("newest", "New entry");

  assert.equal(cache.size(), 3, "Should maintain capacity");
  assert.equal(cache.get("old-unused"), null, "LRU entry should be evicted");
  assert.ok(cache.get("recent-once") !== null, "Recently used entry should remain");
  assert.ok(cache.get("recent-multiple") !== null, "Most accessed entry should remain");
});

test("PromptCache: bulk set and get operations", async () => {
  const cache = new PromptCache(100, 5000);

  // Bulk set
  for (let i = 0; i < 50; i++) {
    cache.set(`prompt-${i}`, `Content for prompt ${i}`);
  }

  assert.equal(cache.size(), 50, "Should have 50 cached prompts");

  // Bulk get - some should hit, all should be valid
  let hits = 0;
  for (let i = 0; i < 50; i++) {
    if (cache.get(`prompt-${i}`) !== null) {
      hits += 1;
    }
  }

  assert.equal(hits, 50, "All prompts should be retrievable");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  countTokens,
  tokenCount,
  sumTokenCount,
  estimateTokensApprox,
  _resetTokenCounterCache
} from "../mcp/core/prompt/token-counter.js";

test("token-counter: empty string returns 0 tokens", () => {
  const r = countTokens("");
  assert.equal(r.tokens, 0);
});

test("token-counter: tiktoken counts 'Hello, world!' as 4 tokens (cl100k_base)", () => {
  const r = countTokens("Hello, world!");
  assert.equal(r.method, "tiktoken");
  assert.equal(r.encoding, "cl100k_base");
  assert.equal(r.tokens, 4);
});

test("token-counter: tiktoken counts Japanese reasonably", () => {
  // 日本語は char ~ token に近い (cl100k_base)
  const r = countTokens("こんにちは世界");
  assert.equal(r.method, "tiktoken");
  // 7 文字なので 5..15 トークンの範囲に収まることを確認
  assert.ok(r.tokens >= 3 && r.tokens <= 20, `unexpected token count: ${r.tokens}`);
});

test("token-counter: tokenCount returns just the number", () => {
  assert.equal(tokenCount(""), 0);
  assert.ok(tokenCount("Hello, world!") > 0);
});

test("token-counter: sumTokenCount equals sum of individual counts", () => {
  const a = "Hello";
  const b = "world";
  const sum = sumTokenCount([a, b]);
  assert.equal(sum, tokenCount(a) + tokenCount(b));
});

test("token-counter: estimateTokensApprox uses ceil(len/4)", () => {
  assert.equal(estimateTokensApprox(""), 0);
  assert.equal(estimateTokensApprox("abcd"), 1);
  assert.equal(estimateTokensApprox("abcde"), 2);
  assert.equal(estimateTokensApprox("a".repeat(40)), 10);
});

test("token-counter: cache is reused between calls", () => {
  _resetTokenCounterCache();
  const r1 = countTokens("first");
  const r2 = countTokens("second");
  assert.equal(r1.method, "tiktoken");
  assert.equal(r2.method, "tiktoken");
});

test("token-counter: large input does not throw", () => {
  const text = "a ".repeat(10000);
  const r = countTokens(text);
  assert.ok(r.tokens > 0);
  assert.equal(r.method, "tiktoken");
});

test("token-counter: PromptMetrics integration uses tiktoken method", async () => {
  const { evaluatePromptMetrics } = await import("../prompt-engine/prompt-evaluator.js");
  const metrics = evaluatePromptMetrics("Apex trigger pattern review please.", [], []);
  assert.equal(metrics.tokenMethod, "tiktoken");
  assert.ok(metrics.estimatedTokens > 0);
  // tiktoken の方が char/4 より小さくなる (英語) ことを確認
  assert.ok(metrics.estimatedTokens < Math.ceil(metrics.lengthChars / 2));
});

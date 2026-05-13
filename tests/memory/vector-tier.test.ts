import assert from "node:assert/strict";
import test from "node:test";

import { classifyVectorTier } from "../../mcp/core/memory/vector-tier.js";

test("classifyVectorTier returns hot for short recent records", () => {
  const tier = classifyVectorTier({
    text: "short note",
    tags: ["a", "b"],
    estimatedTokens: 20,
    updatedAt: new Date().toISOString()
  });

  assert.equal(tier, "hot");
});

test("classifyVectorTier returns warm for larger medium-age records", () => {
  const tier = classifyVectorTier({
    text: "x".repeat(800),
    tags: ["a", "b", "c", "d"],
    estimatedTokens: 600,
    updatedAt: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(tier, "warm");
});

test("classifyVectorTier returns cold for large old records", () => {
  const tier = classifyVectorTier({
    text: "x".repeat(5000),
    tags: ["a", "b", "c", "d", "e"],
    estimatedTokens: 2000,
    updatedAt: "2025-01-01T00:00:00.000Z"
  });

  assert.equal(tier, "cold");
});
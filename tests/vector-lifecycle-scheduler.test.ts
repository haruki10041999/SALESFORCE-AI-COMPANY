import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveVectorTierForAgeDays, resolveNextTier } from "../mcp/core/memory/lifecycle-scheduler.js";

describe("resolveVectorTierForAgeDays", () => {
  it("returns hot within hot window", () => {
    assert.equal(resolveVectorTierForAgeDays(3), "hot");
  });

  it("returns warm between hot and warm windows", () => {
    assert.equal(resolveVectorTierForAgeDays(30), "warm");
  });

  it("returns cold beyond warm window", () => {
    assert.equal(resolveVectorTierForAgeDays(180), "cold");
  });
});

describe("resolveNextTier", () => {
  it("uses updatedAt when present", () => {
    const now = new Date("2026-05-14T00:00:00.000Z");
    const tier = resolveNextTier(
      {
        chunkId: 1,
        currentTier: "cold",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z"
      },
      now
    );
    assert.equal(tier, "hot");
  });

  it("keeps current tier on invalid timestamp", () => {
    const tier = resolveNextTier({
      chunkId: 1,
      currentTier: "warm",
      createdAt: "invalid"
    });
    assert.equal(tier, "warm");
  });
});

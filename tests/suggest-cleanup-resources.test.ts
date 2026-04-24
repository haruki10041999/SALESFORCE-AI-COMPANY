import test from "node:test";
import assert from "node:assert/strict";

import { suggestCleanupResources } from "../mcp/tools/suggest-cleanup-resources.js";

test("suggestCleanupResources detects stale resources by lastUsedAt and never-used age", () => {
  const now = new Date("2026-04-24T00:00:00.000Z");

  const result = suggestCleanupResources({
    now,
    daysUnused: 30,
    limit: 20,
    usage: {
      skills: { "apex/legacy": 0, "apex/active": 3 },
      tools: { legacy_tool: 1 },
      presets: { "Old Preset": 0 }
    },
    bugSignals: {
      skills: { "apex/legacy": 1, "apex/active": 0 },
      tools: { legacy_tool: 0 },
      presets: { "Old Preset": 0 }
    },
    catalogs: {
      skills: ["apex/legacy", "apex/active"],
      presets: ["Old Preset"],
      customTools: ["legacy_tool"]
    },
    activity: {
      skills: {
        "apex/legacy": { firstSeenAt: "2026-01-01T00:00:00.000Z" },
        "apex/active": { lastUsedAt: "2026-04-20T00:00:00.000Z", firstSeenAt: "2026-02-01T00:00:00.000Z" }
      },
      tools: {
        legacy_tool: { lastUsedAt: "2026-02-01T00:00:00.000Z", firstSeenAt: "2026-01-15T00:00:00.000Z" }
      },
      presets: {
        "Old Preset": { lastUsedAt: "2026-03-10T00:00:00.000Z", firstSeenAt: "2026-01-10T00:00:00.000Z" }
      }
    }
  });

  assert.equal(result.thresholdDays, 30);
  assert.equal(result.totalAnalyzed.skills, 2);
  assert.equal(result.totalAnalyzed.customTools, 1);

  const names = result.candidates.map((item) => `${item.resourceType}:${item.name}`);
  assert.ok(names.includes("skills:apex/legacy"));
  assert.ok(names.includes("tools:legacy_tool"));
  assert.ok(names.includes("presets:Old Preset"));
  assert.ok(!names.includes("skills:apex/active"));
});

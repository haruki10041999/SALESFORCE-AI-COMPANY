import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPresetStore } from "../mcp/core/context/preset-store.js";

test("preset store writes versioned and latest files atomically", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-preset-store-test-"));
  const presetsDir = join(root, "outputs", "presets");

  try {
    const store = createPresetStore({
      presetsDir,
      ensureDir: async (dir) => {
        await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
      }
    });

    await store.createPreset({
      name: "Review Helper",
      description: "assist code review",
      topic: "review",
      agents: ["architect"],
      skills: ["apex/review"]
    });

    const latestPath = join(presetsDir, "review-helper.json");
    const versionPath = join(presetsDir, "review-helper", "v1.json");
    const latest = JSON.parse(readFileSync(latestPath, "utf-8")) as { name: string; version: number };
    const versioned = JSON.parse(readFileSync(versionPath, "utf-8")) as { name: string; version: number };

    assert.equal(latest.name, "Review Helper");
    assert.equal(versioned.name, "Review Helper");
    assert.equal(latest.version, 1);
    assert.equal(versioned.version, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
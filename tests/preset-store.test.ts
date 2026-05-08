import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      },
      allowFileFallback: true
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

test("preset store keeps presets in-memory when file fallback is disabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-preset-store-mem-test-"));
  const presetsDir = join(root, "outputs", "presets");

  try {
    const store = createPresetStore({
      presetsDir,
      ensureDir: async (dir) => {
        await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
      }
    });

    await store.createPreset({
      name: "Memory Only Preset",
      description: "in-memory",
      topic: "test",
      agents: ["architect"]
    });

    const data = await store.listPresetsData();
    assert.equal(data.length, 1);
    assert.equal(data[0]?.name, "Memory Only Preset");
    assert.equal(data[0]?.version, 1);
    assert.equal(existsSync(join(root, "outputs", "presets", "memory-only-preset.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
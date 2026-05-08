import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCustomToolRegistry } from "../mcp/core/resource/custom-tool-registry.js";

test("custom-tool-registry does not load files by default", async () => {
  const prev = process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK;
  delete process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK;

  const root = mkdtempSync(join(tmpdir(), "sf-ai-custom-tool-registry-test-"));
  const dir = join(root, "outputs", "custom-tools");

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "demo-tool.json"),
      JSON.stringify({
        name: "demo_tool",
        description: "demo",
        agents: ["architect"],
        skills: [],
        createdAt: new Date().toISOString()
      }),
      "utf-8"
    );

    const registry = createCustomToolRegistry({
      govTool: () => {
        // no-op
      },
      filterDisabledSkills: async (skillNames) => ({ enabled: skillNames, disabled: [] }),
      buildChatPrompt: async () => "prompt"
    });

    await registry.loadCustomToolsFromDir(dir);
    assert.equal(registry.loadedCustomToolNames.size, 0);
  } finally {
    if (prev === undefined) {
      delete process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK;
    } else {
      process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK = prev;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("custom-tool-registry loads files when fallback env is enabled", async () => {
  const prev = process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK;
  process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK = "true";

  const root = mkdtempSync(join(tmpdir(), "sf-ai-custom-tool-registry-test-"));
  const dir = join(root, "outputs", "custom-tools");

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "demo-tool.json"),
      JSON.stringify({
        name: "demo_tool",
        description: "demo",
        agents: ["architect"],
        skills: [],
        createdAt: new Date().toISOString()
      }),
      "utf-8"
    );

    const registry = createCustomToolRegistry({
      govTool: () => {
        // no-op
      },
      filterDisabledSkills: async (skillNames) => ({ enabled: skillNames, disabled: [] }),
      buildChatPrompt: async () => "prompt"
    });

    await registry.loadCustomToolsFromDir(dir);
    assert.equal(registry.loadedCustomToolNames.has("demo_tool"), true);
  } finally {
    if (prev === undefined) {
      delete process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK;
    } else {
      process.env.SF_AI_CUSTOM_TOOL_FILE_FALLBACK = prev;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

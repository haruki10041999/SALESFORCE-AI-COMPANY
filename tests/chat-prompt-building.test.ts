import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildChatPromptFromContext,
  clearBuildChatPromptCache,
  invalidateBuildChatPromptCache,
  getPromptCacheMetrics,
  resetPromptCacheMetrics
} from "../mcp/core/context/chat-prompt-builder.js";

type MdMap = Record<string, string>;

function buildDeps(root: string, markdownMap: MdMap, contextFiles: string[]) {
  return {
    root,
    findMdFilesRecursive: (_dir: string) => contextFiles,
    toPosixPath: (value: string) => value.replace(/\\/g, "/"),
    truncateContent: (text: string) => text,
    getMdFileAsync: async (dir: string, name: string) => {
      const key = `${dir}/${name}`;
      const value = markdownMap[key];
      if (!value) {
        throw new Error(`missing markdown: ${key}`);
      }
      return value;
    }
  };
}

test("buildChatPromptFromContext injects project context and discussion rules", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-"));

  try {
    const contextDir = join(root, "context");
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(contextDir, { recursive: true });
    mkdirSync(promptEngineDir, { recursive: true });

    const contextFile = join(contextDir, "project.md");
    writeFileSync(contextFile, "Project Context Content", "utf-8");
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework Content", "utf-8");

    const prompt = await buildChatPromptFromContext(
      {
        topic: "Apex trigger review",
        agentNames: ["architect"],
        personaName: undefined,
        skillNames: ["apex/apex-best-practices"],
        filePaths: [],
        turns: 3,
        includeProjectContext: true
      },
      buildDeps(
        root,
        {
          "agents/architect": "Architect Agent Definition",
          "skills/apex/apex-best-practices": "Apex Best Practices Skill"
        },
        [contextFile]
      )
    );

    assert.ok(prompt.includes("## プロジェクトコンテキスト"));
    assert.ok(prompt.includes("Project Context Content"));
    assert.ok(prompt.includes("## 参加エージェント定義"));
    assert.ok(prompt.includes("## 適用スキル"));
    assert.ok(prompt.includes("## ディスカッション規約"));
    assert.ok(prompt.includes("発言形式は必ず「**agent-name**: 発言内容」を使う"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildChatPromptFromContext adds review sections by file paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-review-"));

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });

    const sourcePath = join(root, "AccountService.cls");
    writeFileSync(sourcePath, "public class AccountService {}", "utf-8");
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");
    writeFileSync(join(promptEngineDir, "review-framework.md"), "Review Framework", "utf-8");
    writeFileSync(join(promptEngineDir, "review-mode.md"), "Review Mode", "utf-8");

    const prompt = await buildChatPromptFromContext(
      {
        topic: "AccountService の実装確認",
        agentNames: ["qa-engineer"],
        personaName: undefined,
        skillNames: [],
        filePaths: [sourcePath],
        turns: 2,
        includeProjectContext: false
      },
      buildDeps(
        root,
        {
          "agents/qa-engineer": "QA Agent"
        },
        []
      )
    );

    assert.ok(prompt.includes("## コードコンテキスト"));
    assert.ok(prompt.includes("AccountService.cls"));
    assert.ok(prompt.includes("## レビュー観点"));
    assert.ok(prompt.includes("## レビューモード"));
    assert.equal(prompt.includes("## プロジェクトコンテキスト"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildChatPromptFromContext triggers review mode by topic keyword only", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-keyword-"));

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");
    writeFileSync(join(promptEngineDir, "review-mode.md"), "Review Mode", "utf-8");

    const prompt = await buildChatPromptFromContext(
      {
        topic: "設計レビューを実施する",
        agentNames: ["architect"],
        personaName: undefined,
        skillNames: [],
        filePaths: [],
        turns: 1,
        includeProjectContext: false
      },
      buildDeps(
        root,
        {
          "agents/architect": "Architect Agent"
        },
        []
      )
    );

    assert.ok(prompt.includes("## レビューモード"));
    assert.equal(prompt.includes("## レビュー観点"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildChatPromptFromContext reuses cached prompts for identical input", async () => {
  clearBuildChatPromptCache();
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-cache-"));
  let markdownReads = 0;

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");

    const deps = {
      root,
      findMdFilesRecursive: (_dir: string) => [],
      toPosixPath: (value: string) => value.replace(/\\/g, "/"),
      truncateContent: (text: string) => text,
      getMdFileAsync: async (dir: string, name: string) => {
        markdownReads += 1;
        if (dir === "agents" && name === "architect") {
          return "Architect Agent";
        }
        throw new Error(`missing markdown: ${dir}/${name}`);
      }
    };

    const input = {
      topic: "キャッシュ動作確認",
      agentNames: ["architect"],
      personaName: undefined,
      skillNames: [],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    const firstPrompt = await buildChatPromptFromContext(input, deps);
    const secondPrompt = await buildChatPromptFromContext(input, deps);

    assert.equal(firstPrompt, secondPrompt);
    assert.equal(markdownReads, 1);
  } finally {
    clearBuildChatPromptCache();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt cache respects PROMPT_CACHE_MAX_ENTRIES and PROMPT_CACHE_TTL_SECONDS env vars", async () => {
  // Save original env vars
  const originalMaxEntries = process.env.PROMPT_CACHE_MAX_ENTRIES;
  const originalTtlSeconds = process.env.PROMPT_CACHE_TTL_SECONDS;

  try {
    clearBuildChatPromptCache();

    // Test 1: Default values when env vars are not set
    delete process.env.PROMPT_CACHE_MAX_ENTRIES;
    delete process.env.PROMPT_CACHE_TTL_SECONDS;

    const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-config-"));
    mkdirSync(join(root, "prompt-engine"), { recursive: true });
    writeFileSync(join(root, "prompt-engine", "discussion-framework.md"), "Discussion Framework", "utf-8");

    const input = {
      topic: "config test",
      agentNames: [] as string[],
      personaName: undefined,
      skillNames: [],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    const deps = {
      root,
      findMdFilesRecursive: (_dir: string) => [],
      toPosixPath: (value: string) => value.replace(/\\/g, "/"),
      truncateContent: (text: string) => text,
      getMdFileAsync: async (dir: string, name: string) => {
        if (dir === "agents" && name === "product-manager") return "PM Agent";
        if (dir === "agents" && name === "architect") return "Arch Agent";
        if (dir === "agents" && name === "qa-engineer") return "QA Agent";
        throw new Error(`missing markdown: ${dir}/${name}`);
      }
    };

    // Build a prompt (should use defaults: max 100 entries, 60s TTL)
    const prompt1 = await buildChatPromptFromContext(input, deps);
    assert.ok(prompt1);

    // Test 2: Custom values via env vars
    process.env.PROMPT_CACHE_MAX_ENTRIES = "50";
    process.env.PROMPT_CACHE_TTL_SECONDS = "120";

    clearBuildChatPromptCache();
    const prompt2 = await buildChatPromptFromContext(input, deps);
    assert.ok(prompt2);

    // Test 3: Invalid env var values should fall back to defaults
    process.env.PROMPT_CACHE_MAX_ENTRIES = "invalid";
    process.env.PROMPT_CACHE_TTL_SECONDS = "-5";

    clearBuildChatPromptCache();
    const prompt3 = await buildChatPromptFromContext(input, deps);
    assert.ok(prompt3); // Should not throw, uses minimum value 1

    rmSync(root, { recursive: true, force: true });
  } finally {
    // Restore original env vars
    if (originalMaxEntries !== undefined) {
      process.env.PROMPT_CACHE_MAX_ENTRIES = originalMaxEntries;
    } else {
      delete process.env.PROMPT_CACHE_MAX_ENTRIES;
    }
    if (originalTtlSeconds !== undefined) {
      process.env.PROMPT_CACHE_TTL_SECONDS = originalTtlSeconds;
    } else {
      delete process.env.PROMPT_CACHE_TTL_SECONDS;
    }
    clearBuildChatPromptCache();
  }
});

test("prompt cache invalidation clears entries by agent names", async () => {
  clearBuildChatPromptCache();
  resetPromptCacheMetrics();
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-invalidate-"));

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");

    const deps = buildDeps(
      root,
      {
        "agents/architect": "Architect Agent",
        "agents/qa-engineer": "QA Engineer Agent"
      },
      []
    );

    const input1 = {
      topic: "design review",
      agentNames: ["architect"],
      personaName: undefined,
      skillNames: [],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    const input2 = {
      topic: "quality check",
      agentNames: ["qa-engineer"],
      personaName: undefined,
      skillNames: [],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    // Build two different prompts
    const prompt1 = await buildChatPromptFromContext(input1, deps);
    const prompt2 = await buildChatPromptFromContext(input2, deps);
    
    assert.ok(prompt1);
    assert.ok(prompt2);
    assert.notEqual(prompt1, prompt2);

    let metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 0); // First builds are misses
    assert.equal(metrics.misses, 2);
    assert.equal(metrics.size, 2); // Both cached

    // Rebuild first prompt (should hit cache)
    const prompt1Again = await buildChatPromptFromContext(input1, deps);
    assert.equal(prompt1, prompt1Again);

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 1); // One cache hit
    assert.equal(metrics.misses, 2);
    assert.equal(metrics.size, 2);

    // Invalidate by architect agent
    invalidateBuildChatPromptCache({ agentNames: ["architect"] });

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.size, 1); // First prompt invalidated

    // Rebuild first prompt (should miss cache)
    const prompt1New = await buildChatPromptFromContext(input1, deps);
    assert.equal(prompt1, prompt1New);

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 1); // No new hits
    assert.equal(metrics.misses, 3); // One more miss
    assert.equal(metrics.size, 2); // Both cached again
  } finally {
    clearBuildChatPromptCache();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt cache invalidation clears entries by skills", async () => {
  clearBuildChatPromptCache();
  resetPromptCacheMetrics();
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-invalidate-skills-"));

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");

    const deps = buildDeps(
      root,
      {
        "agents/architect": "Architect Agent",
        "skills/apex/best-practices": "Apex Best Practices",
        "skills/lwc/advanced-patterns": "LWC Advanced Patterns"
      },
      []
    );

    const input1 = {
      topic: "apex review",
      agentNames: ["architect"],
      personaName: undefined,
      skillNames: ["apex/best-practices"],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    const input2 = {
      topic: "lwc review",
      agentNames: ["architect"],
      personaName: undefined,
      skillNames: ["lwc/advanced-patterns"],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    // Build two prompts with different skills
    const prompt1 = await buildChatPromptFromContext(input1, deps);
    const prompt2 = await buildChatPromptFromContext(input2, deps);

    assert.ok(prompt1);
    assert.ok(prompt2);
    
    let metrics = getPromptCacheMetrics();
    assert.equal(metrics.size, 2); // Both cached

    // Invalidate by skill
    invalidateBuildChatPromptCache({ skillNames: ["apex/best-practices"] });

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.size, 1); // First prompt invalidated, second still cached

    // LWC prompt should still be cached
    const prompt2Cached = await buildChatPromptFromContext(input2, deps);
    assert.equal(prompt2, prompt2Cached);

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 1); // Cache hit on LWC prompt
  } finally {
    clearBuildChatPromptCache();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt cache metrics track hits, misses, and expirations", async () => {
  clearBuildChatPromptCache();
  resetPromptCacheMetrics();
  const root = mkdtempSync(join(tmpdir(), "chat-prompt-test-metrics-"));

  try {
    const promptEngineDir = join(root, "prompt-engine");
    mkdirSync(promptEngineDir, { recursive: true });
    writeFileSync(join(promptEngineDir, "discussion-framework.md"), "Discussion Framework", "utf-8");

    // Set TTL to 10ms for testing expiration
    const originalTtl = process.env.PROMPT_CACHE_TTL_SECONDS;
    process.env.PROMPT_CACHE_TTL_SECONDS = "1"; // Very short TTL for testing

    const deps = buildDeps(
      root,
      {
        "agents/architect": "Architect Agent"
      },
      []
    );

    const input = {
      topic: "design review",
      agentNames: ["architect"],
      personaName: undefined,
      skillNames: [],
      filePaths: [],
      turns: 1,
      includeProjectContext: false
    };

    // Build prompt (miss)
    const prompt1 = await buildChatPromptFromContext(input, deps);
    assert.ok(prompt1);

    let metrics = getPromptCacheMetrics();
    assert.equal(metrics.misses, 1);
    assert.equal(metrics.hits, 0);
    assert.equal(metrics.size, 1);
    assert.equal(metrics.maxSize, 100); // Default max entries

    // Rebuild immediately (hit)
    const prompt2 = await buildChatPromptFromContext(input, deps);
    assert.equal(prompt1, prompt2);

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 1);
    assert.equal(metrics.misses, 1);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Rebuild after expiration (miss due to expiration)
    const prompt3 = await buildChatPromptFromContext(input, deps);
    assert.equal(prompt1, prompt3); // Content still same

    metrics = getPromptCacheMetrics();
    assert.equal(metrics.hits, 1); // No new hits
    assert.equal(metrics.misses, 2); // One more miss
    assert.equal(metrics.expirations, 1); // One expiration

    if (originalTtl !== undefined) {
      process.env.PROMPT_CACHE_TTL_SECONDS = originalTtl;
    } else {
      delete process.env.PROMPT_CACHE_TTL_SECONDS;
    }
  } finally {
    clearBuildChatPromptCache();
    rmSync(root, { recursive: true, force: true });
  }
});

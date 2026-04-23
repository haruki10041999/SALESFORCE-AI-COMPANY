import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildChatPromptFromContext } from "../mcp/core/context/chat-prompt-builder.js";

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

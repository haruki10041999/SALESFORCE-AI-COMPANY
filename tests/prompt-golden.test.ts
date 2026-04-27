/**
 * F-03: Golden Prompt Suite
 *
 * `tests/prompts/golden/*.json` に定義した期待値で `buildChatPromptFromContext`
 * の出力を回帰検証する。テンプレート修正で意図しないセクション欠落・順序変更を
 * 検知するための安全網。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildChatPromptFromContext,
  clearBuildChatPromptCache
} from "../mcp/core/context/chat-prompt-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "prompts", "golden");

interface GoldenCase {
  name: string;
  description?: string;
  input: {
    topic: string;
    agentNames: string[];
    personaName: string | null;
    skillNames: string[];
    filePaths: string[];
    turns: number;
    maxContextChars: number | null;
    appendInstruction: string | null;
    includeProjectContext: boolean;
  };
  fixtures: {
    contextFiles?: string[];
    markdown: Record<string, string>;
    files: Record<string, string>;
  };
  expected: {
    mustContain?: string[];
    mustNotContain?: string[];
    sectionOrder?: string[];
    minLengthChars?: number;
    maxLengthChars?: number;
  };
}

function loadGoldenCases(): GoldenCase[] {
  const files = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith(".json") && !name.startsWith("_"));
  return files.map((file) => {
    const text = readFileSync(join(GOLDEN_DIR, file), "utf-8");
    return JSON.parse(text) as GoldenCase;
  });
}

function buildDeps(root: string, markdown: Record<string, string>, contextFiles: string[]) {
  return {
    root,
    findMdFilesRecursive: (_dir: string) => contextFiles,
    toPosixPath: (value: string) => value.replace(/\\/g, "/"),
    truncateContent: (text: string) => text,
    getMdFileAsync: async (dir: string, name: string) => {
      const key = `${dir}/${name}`;
      const value = markdown[key];
      if (value === undefined) {
        throw new Error(`golden fixture missing markdown entry: ${key}`);
      }
      return value;
    }
  };
}

function setupFixtures(root: string, files: Record<string, string>): string[] {
  const absolute: string[] = [];
  for (const [relPath, content] of Object.entries(files)) {
    const target = join(root, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
    absolute.push(target);
  }
  return absolute;
}

const cases = loadGoldenCases();

for (const golden of cases) {
  test(`golden prompt: ${golden.name}`, async () => {
    clearBuildChatPromptCache();
    const root = mkdtempSync(join(tmpdir(), `golden-prompt-${golden.name}-`));
    try {
      // ファイル fixture を物理配置 (filePaths が参照するため)
      const absoluteFiles = setupFixtures(root, golden.fixtures.files);
      const contextAbsolute = (golden.fixtures.contextFiles ?? []).map((rel) => join(root, rel));

      // filePaths は fixture の絶対パスに変換
      const filePathMap = new Map<string, string>();
      Object.keys(golden.fixtures.files).forEach((rel, idx) => {
        filePathMap.set(rel, absoluteFiles[idx]);
      });
      const resolvedFilePaths = golden.input.filePaths.map((p) => filePathMap.get(p) ?? p);

      const prompt = await buildChatPromptFromContext(
        {
          topic: golden.input.topic,
          agentNames: golden.input.agentNames,
          personaName: golden.input.personaName ?? undefined,
          skillNames: golden.input.skillNames,
          filePaths: resolvedFilePaths,
          turns: golden.input.turns,
          maxContextChars: golden.input.maxContextChars ?? undefined,
          appendInstruction: golden.input.appendInstruction ?? undefined,
          includeProjectContext: golden.input.includeProjectContext
        },
        buildDeps(root, golden.fixtures.markdown, contextAbsolute)
      );

      const exp = golden.expected;

      for (const needle of exp.mustContain ?? []) {
        assert.ok(
          prompt.includes(needle),
          `expected prompt to contain ${JSON.stringify(needle)}\n--- prompt ---\n${prompt.slice(0, 800)}\n---`
        );
      }
      for (const needle of exp.mustNotContain ?? []) {
        assert.ok(
          !prompt.includes(needle),
          `expected prompt to NOT contain ${JSON.stringify(needle)}`
        );
      }
      if (exp.sectionOrder && exp.sectionOrder.length >= 2) {
        let last = -1;
        for (const section of exp.sectionOrder) {
          const idx = prompt.indexOf(section);
          assert.ok(idx >= 0, `section missing in prompt: ${section}`);
          assert.ok(
            idx > last,
            `section order violated: ${section} appeared before previous (idx=${idx}, last=${last})`
          );
          last = idx;
        }
      }
      if (exp.minLengthChars !== undefined) {
        assert.ok(
          prompt.length >= exp.minLengthChars,
          `prompt too short: ${prompt.length} < ${exp.minLengthChars}`
        );
      }
      if (exp.maxLengthChars !== undefined) {
        assert.ok(
          prompt.length <= exp.maxLengthChars,
          `prompt too long: ${prompt.length} > ${exp.maxLengthChars}`
        );
      }
    } finally {
      clearBuildChatPromptCache();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("golden prompt suite is non-empty", () => {
  assert.ok(cases.length > 0, "expected at least one golden case under tests/prompts/golden/");
});

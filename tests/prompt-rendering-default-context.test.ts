import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_CONTEXT_CHARS,
  resolveDefaultMaxContextChars
} from "../mcp/core/context/prompt-rendering.js";

test("resolveDefaultMaxContextChars returns explicit value when provided", () => {
  const result = resolveDefaultMaxContextChars({
    topic: "Apex 実装",
    filePaths: [],
    maxContextChars: 4321
  });
  assert.equal(result, 4321);
});

test("resolveDefaultMaxContextChars returns review default for review topics", () => {
  const result = resolveDefaultMaxContextChars({
    topic: "LWC コンポーネントのレビュー",
    filePaths: []
  });
  assert.equal(result, DEFAULT_MAX_CONTEXT_CHARS.review);
});

test("resolveDefaultMaxContextChars returns review default when file paths exist", () => {
  const result = resolveDefaultMaxContextChars({
    topic: "機能実装",
    filePaths: ["force-app/main/default/classes/Foo.cls"]
  });
  assert.equal(result, DEFAULT_MAX_CONTEXT_CHARS.review);
});

test("resolveDefaultMaxContextChars returns exploration default for investigation topics", () => {
  const result = resolveDefaultMaxContextChars({
    topic: "本番障害の原因調査",
    filePaths: []
  });
  assert.equal(result, DEFAULT_MAX_CONTEXT_CHARS.exploration);
});

test("resolveDefaultMaxContextChars returns implementation default for normal topics", () => {
  const result = resolveDefaultMaxContextChars({
    topic: "新規Apexサービスの実装",
    filePaths: []
  });
  assert.equal(result, DEFAULT_MAX_CONTEXT_CHARS.implementation);
});

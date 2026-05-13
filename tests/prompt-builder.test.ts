import test from "node:test";
import assert from "node:assert/strict";

import {
  renderPromptTemplate,
  selectReasoningStrategy,
  selectPromptVariant,
  buildPrompt
} from "../mcp/core/prompt/prompt-builder.js";

test("renderPromptTemplate: replaces nested variables", () => {
  const out = renderPromptTemplate("Agent={{agent.name}}; Task={{task}}", {
    agent: { name: "architect", content: "design" },
    task: "Review",
    base: "B",
    framework: "R",
    frameworkLabel: "ReasoningFramework"
  });

  assert.equal(out, "Agent=architect; Task=Review");
});

test("renderPromptTemplate: missing variable becomes empty string", () => {
  const out = renderPromptTemplate("X={{unknown.value}}", {
    agent: { name: "architect", content: "design" },
    task: "Review",
    base: "B",
    framework: "R",
    frameworkLabel: "ReasoningFramework"
  });

  assert.equal(out, "X=");
});

test("selectReasoningStrategy: picks tree-of-thought for compare tasks", () => {
  const strategy = selectReasoningStrategy("Compare two design alternatives and pick one");
  assert.equal(strategy, "tree-of-thought");
});

test("selectReasoningStrategy: picks reflect for review/debug tasks", () => {
  const strategy = selectReasoningStrategy("Review and improve the current implementation");
  assert.equal(strategy, "reflect");
});

test("selectReasoningStrategy: picks tree-of-thought for semantic option-evaluation phrasing", () => {
  const strategy = selectReasoningStrategy("Evaluate multiple options and choose the best approach");
  assert.equal(strategy, "tree-of-thought");
});

test("selectReasoningStrategy: picks reflect for semantic audit phrasing", () => {
  const strategy = selectReasoningStrategy("Audit current flow behavior and refine weak points");
  assert.equal(strategy, "reflect");
});

test("selectPromptVariant: picks review for review tasks", () => {
  const variant = selectPromptVariant("コードレビューして問題点を確認してください");
  assert.equal(variant, "review");
});

test("selectPromptVariant: picks discussion for compare tasks", () => {
  const variant = selectPromptVariant("Compare two design alternatives and discuss trade-offs");
  assert.equal(variant, "discussion");
});

test("buildPrompt: supports explicit strategy override", () => {
  const prompt = buildPrompt(
    { name: "architect", content: "Focus on architecture" },
    "Implement API",
    { strategy: "plan" }
  );
  assert.match(prompt, /ReasoningStrategy\nplan/);
});

test("buildPrompt: auto-selects review variant for review tasks", () => {
  const prompt = buildPrompt(
    { name: "architect", content: "Focus on architecture" },
    "レビューして改善点を洗い出してください"
  );

  assert.match(prompt, /PromptVariant\nreview/);
  assert.match(prompt, /ReviewFramework/);
  assert.match(prompt, /Review Mode/);
});

test("buildPrompt: supports explicit discussion variant override", () => {
  const prompt = buildPrompt(
    { name: "architect", content: "Focus on architecture" },
    "Implement API",
    { variant: "discussion" }
  );

  assert.match(prompt, /PromptVariant\ndiscussion/);
  assert.match(prompt, /DiscussionFramework/);
});

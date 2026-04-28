import test from "node:test";
import assert from "node:assert/strict";

import {
  renderPromptTemplate,
  selectReasoningStrategy,
  buildPrompt
} from "../prompt-engine/prompt-builder.js";

test("renderPromptTemplate: replaces nested variables", () => {
  const out = renderPromptTemplate("Agent={{agent.name}}; Task={{task}}", {
    agent: { name: "architect", content: "design" },
    task: "Review",
    base: "B",
    reasoning: "R"
  });

  assert.equal(out, "Agent=architect; Task=Review");
});

test("renderPromptTemplate: missing variable becomes empty string", () => {
  const out = renderPromptTemplate("X={{unknown.value}}", {
    agent: { name: "architect", content: "design" },
    task: "Review",
    base: "B",
    reasoning: "R"
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

test("buildPrompt: supports explicit strategy override", () => {
  const prompt = buildPrompt(
    { name: "architect", content: "Focus on architecture" },
    "Implement API",
    { strategy: "plan" }
  );
  assert.match(prompt, /ReasoningStrategy\nplan/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAutoSelectionConfidence } from "../mcp/handlers/register-resource-search-tools.js";

test("evaluateAutoSelectionConfidence returns low for close top scores", () => {
  const confidence = evaluateAutoSelectionConfidence({
    skills: [{ score: 0.80 }],
    tools: [{ score: 0.75 }],
    presets: [{ score: 0.50 }]
  });

  assert.equal(confidence.level, "low");
  assert.equal(confidence.topScore, 0.8);
  assert.equal(confidence.secondScore, 0.75);
  assert.equal(confidence.signalCount, 3);
});

test("evaluateAutoSelectionConfidence returns medium for moderate gap", () => {
  const confidence = evaluateAutoSelectionConfidence({
    skills: [{ score: 0.80 }],
    tools: [{ score: 0.55 }],
    presets: [{ score: 0.30 }]
  });

  assert.equal(confidence.level, "medium");
  assert.equal(confidence.topScore, 0.8);
  assert.equal(confidence.secondScore, 0.55);
  assert.equal(confidence.signalCount, 3);
});

test("evaluateAutoSelectionConfidence returns high for clear winner", () => {
  const confidence = evaluateAutoSelectionConfidence({
    skills: [{ score: 0.90 }],
    tools: [{ score: 0.40 }],
    presets: [{ score: 0.10 }]
  });

  assert.equal(confidence.level, "high");
  assert.equal(confidence.topScore, 0.9);
  assert.equal(confidence.secondScore, 0.4);
  assert.equal(confidence.signalCount, 3);
});

test("evaluateAutoSelectionConfidence returns medium when only one signal exists", () => {
  const confidence = evaluateAutoSelectionConfidence({
    skills: [{ score: 0.7 }],
    tools: [],
    presets: []
  });

  assert.equal(confidence.level, "medium");
  assert.equal(confidence.topScore, 0.7);
  assert.equal(confidence.secondScore, 0);
  assert.equal(confidence.signalCount, 1);
});

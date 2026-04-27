import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tunePromptTemplates } from "../mcp/tools/tune-prompt-templates.js";

test("A5: leader is the template with highest combined score", () => {
  const r = tunePromptTemplates([
    {
      name: "tmpl-a",
      samples: [
        { score: 0.9, success: true, tokens: 200 },
        { score: 0.85, success: true, tokens: 220 },
        { score: 0.8, success: true, tokens: 210 }
      ]
    },
    {
      name: "tmpl-b",
      samples: [
        { score: 0.5, success: false, tokens: 400 },
        { score: 0.4, success: false, tokens: 420 },
        { score: 0.45, success: true, tokens: 410 }
      ]
    }
  ]);
  assert.equal(r.leader, "tmpl-a");
  assert.equal(r.recommendations.promote, "tmpl-a");
  assert.ok(r.recommendations.retire.includes("tmpl-b"));
});

test("A5: templates below minSamples are not eligible to lead", () => {
  const r = tunePromptTemplates(
    [
      {
        name: "fresh",
        samples: [{ score: 0.95, success: true }]
      },
      {
        name: "established",
        samples: [
          { score: 0.7, success: true },
          { score: 0.7, success: true },
          { score: 0.7, success: true }
        ]
      }
    ],
    { minSamples: 3 }
  );
  assert.equal(r.leader, "established");
  assert.ok(r.recommendations.retire.includes("fresh"));
});

test("A5: promote is null when leader is below promoteThreshold", () => {
  const r = tunePromptTemplates(
    [
      {
        name: "low",
        samples: [
          { score: 0.3, success: false },
          { score: 0.3, success: false },
          { score: 0.3, success: false }
        ]
      }
    ],
    { minSamples: 3, promoteThreshold: 0.6 }
  );
  assert.equal(r.recommendations.promote, null);
});

test("A5: token efficiency rewards smaller prompts", () => {
  const r = tunePromptTemplates([
    {
      name: "compact",
      samples: [
        { score: 0.7, success: true, tokens: 100 },
        { score: 0.7, success: true, tokens: 100 },
        { score: 0.7, success: true, tokens: 100 }
      ]
    },
    {
      name: "verbose",
      samples: [
        { score: 0.7, success: true, tokens: 800 },
        { score: 0.7, success: true, tokens: 800 },
        { score: 0.7, success: true, tokens: 800 }
      ]
    }
  ]);
  const compact = r.ranking.find((m) => m.name === "compact")!;
  const verbose = r.ranking.find((m) => m.name === "verbose")!;
  assert.ok(compact.tokenEfficiency > verbose.tokenEfficiency);
  assert.ok(compact.combinedScore > verbose.combinedScore);
  assert.equal(r.leader, "compact");
});

test("A5: empty templates array returns no leader", () => {
  const r = tunePromptTemplates([]);
  assert.equal(r.leader, null);
  assert.equal(r.recommendations.promote, null);
  assert.deepEqual(r.recommendations.retire, []);
});

test("A5: ranking is sorted by combinedScore desc with stable tiebreak", () => {
  const r = tunePromptTemplates([
    { name: "z", samples: [{ score: 0.5, success: true }, { score: 0.5, success: true }, { score: 0.5, success: true }] },
    { name: "a", samples: [{ score: 0.5, success: true }, { score: 0.5, success: true }, { score: 0.5, success: true }] }
  ]);
  // Same score → name asc, so "a" first
  assert.equal(r.ranking[0].name, "a");
  assert.equal(r.ranking[1].name, "z");
});

test("A5: out-of-range scores are clipped to 0..1", () => {
  const r = tunePromptTemplates([
    {
      name: "bad",
      samples: [{ score: 5, success: true }, { score: -1, success: false }, { score: 0.5, success: true }]
    }
  ]);
  const bad = r.ranking[0];
  // (1 + 0 + 0.5) / 3 = 0.5
  assert.equal(bad.avgScore, 0.5);
});

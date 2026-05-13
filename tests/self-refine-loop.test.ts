import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

import { runSelfRefineLoop } from "../mcp/core/learning/self-refine-loop.js";
import { executeCritiqueLifecycle } from "../mcp/core/learning/critic-loop.js";
import type { OllamaClient } from "../mcp/core/llm/ollama-client.js";
import type { QualityRubricResult } from "../mcp/core/llm/quality-rubric.js";

function makeResult(score: number): QualityRubricResult {
  return {
    overallScore: score,
    method: "heuristic",
    criteria: [
      { id: "relevance", score, rationale: "r" },
      { id: "completeness", score, rationale: "r" },
      { id: "actionability", score, rationale: "r" },
      { id: "safety", score, rationale: "r" },
      { id: "structure", score, rationale: "r" }
    ]
  };
}

test("runSelfRefineLoop: stops when target score reached", async () => {
  const out = await runSelfRefineLoop("draft", { targetScore: 8 }, {
    evaluate: async () => makeResult(8.4),
    refine: async () => "draft"
  });

  assert.equal(out.stoppedReason, "target-reached");
  assert.equal(out.iterations.length, 1);
  assert.equal(out.finalScore, 8.4);
});

test("runSelfRefineLoop: stops on no improvement threshold", async () => {
  const queue = [makeResult(6.5), makeResult(6.6)];
  const out = await runSelfRefineLoop("draft", { maxIterations: 3, minImprovement: 0.2 }, {
    evaluate: async () => queue.shift() ?? makeResult(6.6),
    refine: async () => "revised"
  });

  assert.equal(out.stoppedReason, "no-improvement");
  assert.equal(out.finalText, "revised");
  assert.equal(out.finalScore, 6.6);
});

test("runSelfRefineLoop: reaches max iterations with sustained improvements", async () => {
  const queue = [makeResult(5.5), makeResult(6.1), makeResult(6.4), makeResult(6.8), makeResult(7.1)];
  const out = await runSelfRefineLoop("draft", { maxIterations: 3, minImprovement: 0.1 }, {
    evaluate: async () => queue.shift() ?? makeResult(7.1),
    refine: async ({ iteration }) => `revised-${iteration}`
  });

  assert.equal(out.stoppedReason, "max-iterations");
  assert.equal(out.iterations.length, 3);
  assert.equal(out.finalText, "revised-2");
});

test("runSelfRefineLoop: heuristic provider does not require LLM client", async () => {
  const out = await runSelfRefineLoop("# Draft\n- step", {
    judge: true,
    provider: "heuristic",
    maxIterations: 2,
    minImprovement: 0.1
  });

  assert.equal(out.stoppedReason, "no-improvement");
  assert.equal(out.iterations.length, 1);
  assert.ok(out.finalScore >= 0 && out.finalScore <= 10);
});

test("runSelfRefineLoop includes custom criteria in the refine prompt", async () => {
  const capturedPrompts: string[] = [];
  const client = {
    chat: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      const userMessage = messages.find((message) => message.role === "user")?.content ?? "";
      capturedPrompts.push(userMessage);
      return {
        model: "dummy",
        message: { role: "assistant", content: "revised draft" },
        done: true
      };
    }
  } as unknown as OllamaClient;

  const out = await runSelfRefineLoop(
    "draft",
    {
      provider: "ollama",
      maxIterations: 2,
      minImprovement: 0.1,
      criteria: [
        {
          id: "clarity",
          label: "Clarity",
          description: "Ensure the response is explicit and easy to follow.",
          weight: 1
        }
      ]
    },
    {
      client,
      evaluate: async () => makeResult(5)
    }
  );

  assert.equal(capturedPrompts.length, 1);
  assert.ok(capturedPrompts[0].includes("clarity"));
  assert.ok(capturedPrompts[0].includes("Clarity"));
  assert.equal(out.stoppedReason, "no-improvement");
});

test("executeCritiqueLifecycle records critique run and proposes follow-up when score is low", async () => {
  const root = mkdtempSync(pathJoin(tmpdir(), "critic-loop-"));
  const outputsDir = pathJoin(root, "outputs");
  try {
    process.env.SF_AI_OUTPUTS_DIR = outputsDir;

    const out = await executeCritiqueLifecycle({
      response: "draft",
      topic: "temporal workflow",
      agentName: "architect",
      maxIterations: 1,
      targetScore: 8.5,
      minImprovement: 0.2
    });

    assert.equal(out.nextAction, "proposal");
    assert.ok(out.aiQualityScore >= 0 && out.aiQualityScore <= 1);
    assert.ok(out.proposalDraft?.title.includes("architect"));

    const logPath = pathJoin(outputsDir, "learning", "critic-runs.jsonl");
    const raw = readFileSync(logPath, "utf-8").trim();
    assert.ok(raw.length > 0);
    const record = JSON.parse(raw) as { aiQualityScore: number; nextAction: string };
    assert.equal(record.nextAction, "proposal");
    assert.ok(record.aiQualityScore >= 0 && record.aiQualityScore <= 1);

    const pendingDir = pathJoin(outputsDir, "tool-proposals", "pending");
    const proposalFiles = readdirSync(pendingDir).filter((name) => name.endsWith(".json"));
    assert.equal(proposalFiles.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete process.env.SF_AI_OUTPUTS_DIR;
  }
});

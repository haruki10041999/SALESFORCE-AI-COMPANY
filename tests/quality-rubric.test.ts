import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RUBRIC_CRITERIA,
  buildJudgePrompt,
  evaluateHeuristicRubric,
  evaluateQualityRubric,
  getRubricJudgeProvider,
  parseJudgeResponse
} from "../mcp/core/llm/quality-rubric.js";
import { OllamaClient } from "../mcp/core/llm/ollama-client.js";

function judgeClient(jsonResponse: string): OllamaClient {
  const fakeFetch = (async (_input: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body?.messages) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "qwen2.5:3b",
          message: { role: "assistant", content: jsonResponse },
          done: true
        }),
        text: async () => ""
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: "qwen2.5:3b", response: jsonResponse, done: true }),
      text: async () => ""
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
}

function endpointTrackingJudgeClient(jsonResponse: string): { client: OllamaClient; endpoints: string[] } {
  const endpoints: string[] = [];
  const fakeFetch = (async (input: unknown) => {
    endpoints.push(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "qwen2.5:3b",
        message: { role: "assistant", content: jsonResponse },
        done: true
      }),
      text: async () => ""
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 }), endpoints };
}

function failingClient(): OllamaClient {
  const fakeFetch = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  return new OllamaClient({ fetchImpl: fakeFetch, maxRetries: 0 });
}

test("DEFAULT_RUBRIC_CRITERIA: weights sum approximately to 1.0", () => {
  const total = DEFAULT_RUBRIC_CRITERIA.reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 0.0001, `weights sum=${total}`);
});

test("getRubricJudgeProvider: resolves AI_* then SF_AI_* with ollama default", () => {
  assert.equal(getRubricJudgeProvider({}), "ollama");
  assert.equal(getRubricJudgeProvider({ SF_AI_LLM_PROVIDER: "heuristic" }), "heuristic");
  assert.equal(
    getRubricJudgeProvider({ AI_LLM_PROVIDER: "ollama", SF_AI_LLM_PROVIDER: "heuristic" }),
    "ollama"
  );
});

test("buildJudgePrompt: includes topic and criteria ids", () => {
  const p = buildJudgePrompt("response text", DEFAULT_RUBRIC_CRITERIA, "TOPIC_X");
  assert.ok(p.includes("TOPIC_X"));
  assert.ok(p.includes("relevance"));
  assert.ok(p.includes("safety"));
  assert.ok(p.includes("response text"));
});

test("parseJudgeResponse: extracts JSON from raw text", () => {
  const raw = '{"criteria":[{"id":"relevance","score":8,"rationale":"good"}]}';
  const r = parseJudgeResponse(raw);
  assert.ok(r);
  assert.equal(r!.criteria[0]?.id, "relevance");
  assert.equal(r!.criteria[0]?.score, 8);
});

test("parseJudgeResponse: extracts JSON from fenced code block", () => {
  const raw = "```json\n{\"criteria\":[{\"id\":\"x\",\"score\":7.5,\"rationale\":\"ok\"}]}\n```";
  const r = parseJudgeResponse(raw);
  assert.ok(r);
  assert.equal(r!.criteria[0]?.score, 7.5);
});

test("parseJudgeResponse: clips out-of-range score to 0..10", () => {
  const raw = '{"criteria":[{"id":"x","score":42,"rationale":""},{"id":"y","score":-5,"rationale":""}]}';
  const r = parseJudgeResponse(raw)!;
  assert.equal(r.criteria.find((c) => c.id === "x")?.score, 10);
  assert.equal(r.criteria.find((c) => c.id === "y")?.score, 0);
});

test("parseJudgeResponse: invalid JSON returns null", () => {
  assert.equal(parseJudgeResponse("not json"), null);
  assert.equal(parseJudgeResponse(""), null);
});

test("parseJudgeResponse: non-array criteria returns null", () => {
  assert.equal(parseJudgeResponse('{"criteria": "oops"}'), null);
});

test("evaluateHeuristicRubric: returns scores for all default criteria", () => {
  const r = evaluateHeuristicRubric("# Header\n- bullet\n```\ncode\n```\nApex Trigger Test");
  assert.equal(r.method, "heuristic");
  assert.equal(r.criteria.length, DEFAULT_RUBRIC_CRITERIA.length);
  assert.ok(r.overallScore >= 0 && r.overallScore <= 10);
});

test("evaluateHeuristicRubric: empty response yields low overall", () => {
  const r = evaluateHeuristicRubric("");
  assert.ok(r.overallScore < 5);
});

test("evaluateHeuristicRubric: rich response scores higher than empty", () => {
  const empty = evaluateHeuristicRubric("");
  const rich = evaluateHeuristicRubric(
    "# Apex Trigger\n## Test\n- step1\n- step2\n```apex\ntrigger T on Account\n```\nLWC Flow Permission"
  );
  assert.ok(rich.overallScore > empty.overallScore);
});

test("evaluateQualityRubric: judge mode parses response", async () => {
  const r = await evaluateQualityRubric("any response", {
    client: judgeClient(
      '{"criteria":[{"id":"relevance","score":8,"rationale":"r"},{"id":"completeness","score":7,"rationale":"r"},{"id":"actionability","score":9,"rationale":"r"},{"id":"safety","score":8,"rationale":"r"},{"id":"structure","score":7,"rationale":"r"}]}'
    )
  });
  assert.equal(r.method, "judge");
  assert.equal(r.criteria.length, 5);
  assert.ok(r.overallScore > 6 && r.overallScore < 10);
});

test("evaluateQualityRubric: uses /api/chat endpoint for judge", async () => {
  const tracked = endpointTrackingJudgeClient(
    '{"criteria":[{"id":"relevance","score":8,"rationale":"r"},{"id":"completeness","score":7,"rationale":"r"},{"id":"actionability","score":9,"rationale":"r"},{"id":"safety","score":8,"rationale":"r"},{"id":"structure","score":7,"rationale":"r"}]}'
  );
  const r = await evaluateQualityRubric("any response", { client: tracked.client });
  assert.equal(r.method, "judge");
  assert.ok(tracked.endpoints.some((endpoint) => endpoint.endsWith("/api/chat")));
});

test("evaluateQualityRubric: judge missing some criteria -> heuristic fills", async () => {
  const r = await evaluateQualityRubric("# Title\n- bullet", {
    client: judgeClient('{"criteria":[{"id":"relevance","score":9,"rationale":"r"}]}')
  });
  assert.equal(r.method, "judge");
  assert.equal(r.criteria.length, 5);
  assert.equal(r.criteria.find((c) => c.id === "relevance")?.score, 9);
  assert.match(r.criteria.find((c) => c.id === "safety")?.rationale ?? "", /heuristic|judge missing/);
});

test("evaluateQualityRubric: judge failure -> heuristic fallback", async () => {
  const r = await evaluateQualityRubric("# X\n- y", {
    client: failingClient(),
    fallbackOnFailure: true
  });
  assert.equal(r.method, "heuristic");
  assert.equal(r.criteria.length, 5);
});

test("evaluateQualityRubric: fallbackOnFailure=false rethrows", async () => {
  await assert.rejects(() =>
    evaluateQualityRubric("x", { client: failingClient(), fallbackOnFailure: false })
  );
});

test("evaluateQualityRubric: garbage judge response -> heuristic fallback", async () => {
  const r = await evaluateQualityRubric("text", {
    client: judgeClient("Sorry, I cannot comply.")
  });
  assert.equal(r.method, "heuristic");
});

test("evaluateQualityRubric: provider=heuristic skips judge client", async () => {
  const r = await evaluateQualityRubric("text", {
    provider: "heuristic",
    client: failingClient(),
    fallbackOnFailure: false
  });
  assert.equal(r.method, "heuristic");
});

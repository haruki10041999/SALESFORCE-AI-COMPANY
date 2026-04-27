import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildEvaluatedResponse,
  collectHistoryJsonFiles,
  compareReplayVariants,
  generateReplaySummary,
  loadReplaySession,
  normalizeReplaySession,
  parseReplayArgs
} from "../scripts/learning-replay.js";

test("learning-replay parses CLI args for batch and compare modes", () => {
  const parsed = parseReplayArgs([
    "--session", "session-1",
    "--new-agent", "architect",
    "--new-prompt", "Prefer explicit test steps.",
    "--compare",
    "--limit", "10",
    "--judge"
  ]);

  assert.equal(parsed.sessionId, "session-1");
  assert.equal(parsed.newAgent, "architect");
  assert.equal(parsed.newPrompt, "Prefer explicit test steps.");
  assert.equal(parsed.compare, true);
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.judge, true);
});

test("learning-replay normalizes current history-store chat sessions", () => {
  const normalized = normalizeReplaySession({
    id: "2026-04-27-100000",
    timestamp: "2026-04-27T10:00:00.000Z",
    topic: "Apex review",
    agents: ["architect", "qa-engineer"],
    entries: [
      { agent: "user", message: "Review this Apex trigger", timestamp: "2026-04-27T10:00:00.000Z" },
      { agent: "architect", message: "Add CRUD/FLS checks and tests.", timestamp: "2026-04-27T10:00:10.000Z" }
    ]
  });

  assert.equal(normalized.sessionId, "2026-04-27-100000");
  assert.equal(normalized.sourceFormat, "history-store");
  assert.equal(normalized.agentName, "architect");
  assert.equal(normalized.messages.length, 2);
  assert.equal(normalized.messages[0]?.role, "user");
  assert.equal(normalized.messages[1]?.role, "assistant");
});

test("learning-replay loads nested history files and builds replay summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-learning-replay-"));
  const historyDir = join(root, "outputs", "history");
  const dayDir = join(historyDir, "2026-04-27");

  try {
    await mkdir(dayDir, { recursive: true });
    await writeFile(join(dayDir, "session-a.json"), JSON.stringify({
      id: "session-a",
      timestamp: "2026-04-27T10:00:00.000Z",
      topic: "Flow review",
      agents: ["flow-specialist"],
      entries: [
        { agent: "user", message: "Check this flow", timestamp: "2026-04-27T10:00:00.000Z" },
        { agent: "flow-specialist", message: "Add fault paths and assertions.\n\n```apex\nSystem.debug('x');\n```", timestamp: "2026-04-27T10:00:05.000Z" }
      ]
    }, null, 2), "utf-8");

    const files = await collectHistoryJsonFiles(historyDir);
    assert.equal(files.length, 1);

    const session = await loadReplaySession("session-a", historyDir);
    const evaluated = buildEvaluatedResponse(session);

    assert.ok(evaluated.includes("# Topic"));
    assert.ok(evaluated.includes("flow-specialist"));

    const comparison = await compareReplayVariants(session, {
      newAgent: "architect",
      newPrompt: "Prefer explicit rollback steps."
    });

    assert.equal(comparison.variants.length, 2);
    assert.ok(comparison.baseline.rubric.overallScore > 0);

    const markdown = generateReplaySummary([comparison.baseline]);
    assert.ok(markdown.includes("Offline Evaluation Summary"));
    assert.ok(markdown.includes("session-a"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
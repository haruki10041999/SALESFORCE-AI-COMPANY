import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAgentReputationSnapshot,
  loadAgentReputationRecords,
  updateAgentReputation
} from "../mcp/core/learning/agent-reputation.js";

test("agent reputation persists updates and builds scoped snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-agent-reputation-"));
  const filePath = join(root, "agent-reputation.jsonl");

  try {
    await updateAgentReputation({
      filePath,
      agentName: "architect",
      scope: "global",
      scopeKey: "global",
      delta: 0.2,
      reason: "stable outcomes"
    });
    await updateAgentReputation({
      filePath,
      agentName: "architect",
      scope: "topic",
      scopeKey: "security",
      delta: 0.1,
      reason: "good security guidance"
    });

    const records = await loadAgentReputationRecords(filePath);
    assert.equal(records.length, 2);

    const snapshot = buildAgentReputationSnapshot(records, {
      agentName: "architect",
      topic: "security"
    });

    assert.equal(snapshot.global > 0.5, true);
    assert.equal(snapshot.topic?.score !== undefined, true);
    assert.equal(snapshot.effective >= 0, true);
    assert.equal(snapshot.effective <= 1, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent reputation clamps score into 0..1", async () => {
  const root = await mkdtemp(join(tmpdir(), "sf-ai-agent-reputation-clamp-"));
  const filePath = join(root, "agent-reputation.jsonl");

  try {
    const first = await updateAgentReputation({
      filePath,
      agentName: "qa-engineer",
      scope: "global",
      scopeKey: "global",
      delta: -1
    });
    const second = await updateAgentReputation({
      filePath,
      agentName: "qa-engineer",
      scope: "global",
      scopeKey: "global",
      delta: 2
    });

    assert.equal(first.scoreAfter, 0);
    assert.equal(second.scoreAfter, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

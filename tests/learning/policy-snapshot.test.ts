/**
 * T-07: Online Policy Hook – unit tests for PolicySnapshotManager
 * Runs without Docker. Uses in-memory stubs.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PolicySnapshotManager } from "../../mcp/core/learning/policy-snapshot.js";
import { createLinUcbState, toLinUcbSnapshot } from "../../mcp/core/learning/lin-ucb-bandit.js";

// ── helpers ──────────────────────────────────────────────────────────────────

async function writeTempSnapshot(dir: string, state: ReturnType<typeof createLinUcbState>): Promise<string> {
  const file = join(dir, `bandit-${Date.now()}.json`);
  await writeFile(file, JSON.stringify(toLinUcbSnapshot(state)));
  return file;
}

async function writeTempReputation(dir: string): Promise<string> {
  const file = join(dir, `reputation-${Date.now()}.jsonl`);
  // Write a couple of reputation records
  const records = [
    { id: "r1", timestamp: new Date().toISOString(), agentName: "apex-developer", scope: "global", scopeKey: "global", delta: 0.3, scoreBefore: 0.5, scoreAfter: 0.8 },
    { id: "r2", timestamp: new Date().toISOString(), agentName: "lwc-developer",  scope: "global", scopeKey: "global", delta: 0.1, scoreBefore: 0.5, scoreAfter: 0.6 }
  ];
  await writeFile(file, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  return file;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PolicySnapshotManager", () => {
  const dir = tmpdir();
  let banditStateFile: string;
  let agentReputationFile: string;

  before(async () => {
    const state = createLinUcbState(3, ["apex-developer", "lwc-developer", "qa-engineer"]);
    banditStateFile = await writeTempSnapshot(dir, state);
    agentReputationFile = await writeTempReputation(dir);
  });

  it("loads snapshot on start()", async () => {
    const mgr = new PolicySnapshotManager({
      banditStateFile,
      agentReputationFile,
      // no databaseUrl → no Postgres LISTEN
      onlineMode: "live",
    });

    await mgr.start();
    const snap = mgr.current;
    assert.ok(snap !== null, "snapshot should not be null after start");
    assert.ok(snap!.version >= 1, "version should be >= 1");
    assert.ok(snap!.refreshedAt, "refreshedAt should be set");
    await mgr.close();
  });

  it("scheduleRefresh bumps version after debounce", async () => {
    const mgr = new PolicySnapshotManager({
      banditStateFile,
      agentReputationFile,
      debounceMs: 10,
      onlineMode: "live",
    });

    await mgr.start();
    const vBefore = mgr.current!.version;
    mgr.scheduleRefresh();
    // Wait for debounce + refresh
    await new Promise<void>(resolve => {
      mgr.once("refreshed", () => resolve());
    });
    const vAfter = mgr.current!.version;
    assert.ok(vAfter > vBefore, `version should increase: ${vBefore} → ${vAfter}`);
    await mgr.close();
  });

  it("reputationScores returns a map for each candidate", async () => {
    const mgr = new PolicySnapshotManager({
      banditStateFile,
      agentReputationFile,
      onlineMode: "live",
    });

    await mgr.start();
    const scores = mgr.reputationScores(["apex-developer", "lwc-developer"], "lwc");
    assert.equal(scores.size, 2, "should return a score for each candidate");
    for (const [agent, score] of scores) {
      assert.ok(typeof score === "number" && score >= 0 && score <= 1, `score for ${agent} should be in [0,1]`);
    }
    await mgr.close();
  });

  it("shadow mode: selectAgent returns null", async () => {
    const mgr = new PolicySnapshotManager({
      banditStateFile,
      agentReputationFile,
      onlineMode: "shadow",
    });

    await mgr.start();
    const result = await mgr.selectAgent({
      candidates: ["apex-developer", "lwc-developer"],
      topic: "apex",
    });
    assert.equal(result, null, "shadow mode should return null");
    await mgr.close();
  });

  it("live mode: selectAgent returns a result or null (no crash)", async () => {
    const mgr = new PolicySnapshotManager({
      banditStateFile,
      agentReputationFile,
      onlineMode: "live",
    });

    await mgr.start();
    // May return null if no arms exist yet – that is fine
    const result = await mgr.selectAgent({
      candidates: ["apex-developer", "lwc-developer"],
      topic: "apex",
    });
    if (result !== null) {
      assert.ok(typeof result.selectedAgent === "string", "selectedAgent should be string");
      assert.ok(typeof result.snapshotVersion === "number", "snapshotVersion should be number");
    }
    await mgr.close();
  });

  it("isLive reflects onlineMode", async () => {
    const live = new PolicySnapshotManager({ banditStateFile, agentReputationFile, onlineMode: "live" });
    assert.equal(live.isLive, true);
    await live.close();

    const shadow = new PolicySnapshotManager({ banditStateFile, agentReputationFile, onlineMode: "shadow" });
    assert.equal(shadow.isLive, false);
    await shadow.close();
  });

  it("drift freeze state forces shadow mode when onlineMode is omitted", async () => {
    const originalStatePath = process.env.SF_AI_DRIFT_FREEZE_STATE_PATH;
    const freezePath = join(tmpdir(), `drift-freeze-${Date.now()}.json`);

    await writeFile(
      freezePath,
      `${JSON.stringify({
        frozen: true,
        reason: "drift alert",
        triggeredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })}\n`
    );
    process.env.SF_AI_DRIFT_FREEZE_STATE_PATH = freezePath;
    process.env.SF_AI_LEARNING_MODE = "live";

    try {
      const mgr = new PolicySnapshotManager({ banditStateFile, agentReputationFile });
      assert.equal(mgr.mode, "shadow");
      assert.equal(mgr.isLive, false);
      await mgr.close();
    } finally {
      if (originalStatePath === undefined) {
        delete process.env.SF_AI_DRIFT_FREEZE_STATE_PATH;
      } else {
        process.env.SF_AI_DRIFT_FREEZE_STATE_PATH = originalStatePath;
      }
      delete process.env.SF_AI_LEARNING_MODE;
    }
  });
});

describe("dequeue_next_agent uses online posterior (integration stub)", () => {
  it("prioritizeQueueByPolicy orders agents by reputation when live", async () => {
    // This test exercises the reputationScores path directly
    const dir2 = tmpdir();
    const state = createLinUcbState(2, ["apex-developer", "lwc-developer"]);
    const bf = await writeTempSnapshot(dir2, state);
    const af = join(dir2, `rep-${Date.now()}.jsonl`);
    // apex gets high score, lwc gets low
    const records = [
      { id: "r3", timestamp: new Date().toISOString(), agentName: "apex-developer", scope: "global", scopeKey: "global", delta: 0.4, scoreBefore: 0.5, scoreAfter: 0.9 },
      { id: "r4", timestamp: new Date().toISOString(), agentName: "lwc-developer",  scope: "global", scopeKey: "global", delta: -0.3, scoreBefore: 0.5, scoreAfter: 0.2 }
    ];
    await writeFile(af, records.map(r => JSON.stringify(r)).join("\n") + "\n");

    const mgr = new PolicySnapshotManager({ banditStateFile: bf, agentReputationFile: af, onlineMode: "live" });
    await mgr.start();

    const candidates = ["lwc-developer", "apex-developer"];
    const scores = mgr.reputationScores(candidates, "apex");
    // apex-developer gets global=0.9, lwc-developer gets global=0.2
    // The topic component may vary, but reputation scores should be distinct
    const apexScore = scores.get("apex-developer") ?? 0;
    const lwcScore = scores.get("lwc-developer") ?? 0;
    assert.ok(apexScore > lwcScore, `apex-developer reputation (${apexScore}) should exceed lwc-developer (${lwcScore})`);
    await mgr.close();
  });
});

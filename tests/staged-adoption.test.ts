/**
 * Tests for staged adoption mechanism
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "path";
import * as fs from "fs";
import {
  createStagedProposal,
  loadStagedProposals,
  transitionProposalStage,
  evaluateShadowExecution,
  evaluateCanaryRollout,
  shouldTriggerRollback,
  executeRollback,
  getAdoptionSummary
} from "../mcp/core/learning/staged-adoption.js";

const testDir = path.resolve("outputs", "learning");

async function setupTest(): Promise<void> {
  try {
    await fs.promises.mkdir(testDir, { recursive: true });
  } catch {
    // ignored
  }
}

async function cleanupTest(): Promise<void> {
  try {
    await fs.promises.unlink(path.resolve(testDir, "staged-proposals.jsonl"));
  } catch {
    // file may not exist
  }
}

test("createStagedProposal initializes with shadow stage", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("test-tool-v1", "1.0.0", "0.9.0");

    assert.ok(proposal.proposalId);
    assert.equal(proposal.toolName, "test-tool-v1");
    assert.equal(proposal.stage, "shadow");
    assert.equal(proposal.version, "1.0.0");
    assert.ok(proposal.shadowConfig?.enabled);
    assert.equal(proposal.shadowConfig.executionCount, 0);
  } finally {
    await cleanupTest();
  }
});

test("loadStagedProposals returns all proposals", async () => {
  await setupTest();
  try {
    const p1 = await createStagedProposal("tool-a", "1.0");
    const p2 = await createStagedProposal("tool-b", "2.0");

    const all = await loadStagedProposals();
    assert.equal(all.length, 2);
    assert.ok(all.map((p) => p.proposalId).includes(p1.proposalId));
    assert.ok(all.map((p) => p.proposalId).includes(p2.proposalId));
  } finally {
    await cleanupTest();
  }
});

test("transitionProposalStage moves to next stage", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-c", "1.0");
    const updated = await transitionProposalStage(proposal.proposalId, "canary", "Ready for canary");

    assert.ok(updated);
    assert.equal(updated.stage, "canary");
    assert.equal(updated.stageHistory.length, 2);
    assert.equal(updated.stageHistory[1].reason, "Ready for canary");
    assert.ok(updated.canaryConfig?.enabled);
  } finally {
    await cleanupTest();
  }
});

test("evaluateShadowExecution returns not ready for empty rewards", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-shadow", "1.0");
    const result = await evaluateShadowExecution(proposal.proposalId);

    assert.equal(result.ready, false);
    assert.ok(result.reason.includes("Not ready"));
    assert.equal(result.metrics.avgReward, 0);
  } finally {
    await cleanupTest();
  }
});

test("evaluateCanaryRollout returns not ready for insufficient data", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-canary", "1.0");
    await transitionProposalStage(proposal.proposalId, "canary");

    const result = await evaluateCanaryRollout(proposal.proposalId);

    assert.equal(result.ready, false);
    assert.ok(result.reason.includes("Not ready"));
  } finally {
    await cleanupTest();
  }
});

test("shouldTriggerRollback returns false for insufficient data", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-rollback", "1.0");
    const result = await shouldTriggerRollback(proposal.proposalId);

    assert.equal(result.shouldRollback, false);
    assert.ok(result.reason.includes("Insufficient"));
  } finally {
    await cleanupTest();
  }
});

test("executeRollback transitions to rolled-back stage", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-rb", "1.0", "0.9.0");
    const rolled = await executeRollback(proposal.proposalId);

    assert.ok(rolled);
    assert.equal(rolled.stage, "rolled-back");
    assert.ok(rolled.stageHistory.some((h) => h.stage === "rolled-back"));
  } finally {
    await cleanupTest();
  }
});

test("getAdoptionSummary counts proposals by stage", async () => {
  await setupTest();
  try {
    await createStagedProposal("tool-1", "1.0");
    const p2 = await createStagedProposal("tool-2", "1.0");
    await createStagedProposal("tool-3", "1.0");

    await transitionProposalStage(p2.proposalId, "canary");

    const summary = await getAdoptionSummary();

    assert.equal(summary.totalProposals, 3);
    assert.equal(summary.byStage.shadow, 2);
    assert.equal(summary.byStage.canary, 1);
    assert.equal(summary.byStage.stable, 0);
    assert.equal(summary.successRate, 0); // No stable proposals yet
  } finally {
    await cleanupTest();
  }
});

test("stageHistory preserves all transitions", async () => {
  await setupTest();
  try {
    const proposal = await createStagedProposal("tool-history", "1.0");

    await transitionProposalStage(proposal.proposalId, "canary", "Passed shadow");
    await transitionProposalStage(proposal.proposalId, "stable", "Passed canary");

    const proposals = await loadStagedProposals();
    const updated = proposals.find((p) => p.proposalId === proposal.proposalId)!;

    assert.equal(updated.stageHistory.length, 3); // shadow + canary + stable
    assert.equal(updated.stageHistory[0].stage, "shadow");
    assert.equal(updated.stageHistory[1].stage, "canary");
    assert.equal(updated.stageHistory[2].stage, "stable");
  } finally {
    await cleanupTest();
  }
});

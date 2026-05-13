import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProposal,
  nextProposalId,
  enqueueProposal,
  listProposals,
  getProposal,
  approveProposal,
  rejectProposal,
  approveProposalStage,
  rejectProposalStage,
  summarizeProposalQueue,
  resolveProposalQueuePaths
} from "../mcp/core/resource/proposal/queue.js";
import { createFileProposalQueueStore } from "../mcp/core/resource/proposal/proposal-queue-store.js";
import { executeListProposals } from "../mcp/core/application/governance/services/proposal-queue-apply-operations.js";

function withTmp(): { outputsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-proposal-"));
  return { outputsDir: join(root, "outputs"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("nextProposalId is unique per call (different rand)", () => {
  let i = 0;
  const id1 = nextProposalId(1714000000000, () => (i++ % 2 === 0 ? 0.1 : 0.9));
  const id2 = nextProposalId(1714000000000, () => (i++ % 2 === 0 ? 0.1 : 0.9));
  assert.notEqual(id1, id2);
  assert.match(id1, /^prop-/);
});

test("buildProposal clamps confidence to 0..1", () => {
  const p1 = buildProposal({ resourceType: "skills", name: "x", content: "y", confidence: 9 }, new Date(), "id1");
  assert.equal(p1.confidence, 1);
  const p2 = buildProposal({ resourceType: "tools", name: "x", content: "y", confidence: -3 }, new Date(), "id2");
  assert.equal(p2.confidence, 0);
});

test("buildProposal rejects empty name/content", () => {
  assert.throws(() => buildProposal({ resourceType: "skills", name: " ", content: "ok" }, new Date(), "id"));
  assert.throws(() => buildProposal({ resourceType: "skills", name: "x", content: "  " }, new Date(), "id"));
});

test("enqueueProposal writes pending JSON file", () => {
  const tmp = withTmp();
  try {
    const r = enqueueProposal(tmp.outputsDir, {
      resourceType: "skills", name: "auto-skill", content: "# heading\nbody", confidence: 0.42
    });
    assert.equal(r.status, "pending");
    const paths = resolveProposalQueuePaths(tmp.outputsDir);
    assert.ok(existsSync(join(paths.pendingDir, `${r.id}.json`)));
  } finally { tmp.cleanup(); }
});

test("enqueueProposal writes encrypted file when at-rest encryption is enabled", () => {
  const tmp = withTmp();
  const prevEnabled = process.env.SF_AI_ENCRYPTION_ENABLED;
  const prevKey = process.env.SF_AI_ENCRYPTION_KEY_B64;
  const prevKeyId = process.env.SF_AI_ENCRYPTION_KEY_ID;
  const keyB64 = Buffer.from("0123456789abcdef0123456789abcdef", "utf-8").toString("base64");

  try {
    process.env.SF_AI_ENCRYPTION_ENABLED = "true";
    process.env.SF_AI_ENCRYPTION_KEY_B64 = keyB64;
    process.env.SF_AI_ENCRYPTION_KEY_ID = "test-proposal-v1";

    const r = enqueueProposal(tmp.outputsDir, {
      resourceType: "skills", name: "secure-skill", content: "sensitive content"
    });
    const paths = resolveProposalQueuePaths(tmp.outputsDir);
    const raw = readFileSync(join(paths.pendingDir, `${r.id}.json`), "utf-8");
    assert.equal(raw.includes("sensitive content"), false);
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    assert.equal(typeof parsed.ciphertext, "string");
    assert.equal(parsed.keyId, "test-proposal-v1");

    const loaded = getProposal(tmp.outputsDir, r.id);
    assert.equal(loaded?.content, "sensitive content");
  } finally {
    if (typeof prevEnabled === "string") {
      process.env.SF_AI_ENCRYPTION_ENABLED = prevEnabled;
    } else {
      delete process.env.SF_AI_ENCRYPTION_ENABLED;
    }
    if (typeof prevKey === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_B64 = prevKey;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_B64;
    }
    if (typeof prevKeyId === "string") {
      process.env.SF_AI_ENCRYPTION_KEY_ID = prevKeyId;
    } else {
      delete process.env.SF_AI_ENCRYPTION_KEY_ID;
    }
    tmp.cleanup();
  }
});

test("listProposals filters by status and resourceType", () => {
  const tmp = withTmp();
  try {
    enqueueProposal(tmp.outputsDir, { resourceType: "skills", name: "s1", content: "c" });
    enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "t1", content: "c" });
    const r3 = enqueueProposal(tmp.outputsDir, { resourceType: "presets", name: "p1", content: "c" });
    approveProposal(tmp.outputsDir, r3.id);

    const allPending = listProposals(tmp.outputsDir, { status: "pending" });
    assert.equal(allPending.length, 2);
    const onlyTools = listProposals(tmp.outputsDir, { resourceType: "tools" });
    assert.equal(onlyTools.length, 1);
    const allApproved = listProposals(tmp.outputsDir, { status: "approved" });
    assert.equal(allApproved.length, 1);
    assert.equal(allApproved[0].name, "p1");
  } finally { tmp.cleanup(); }
});

test("approveProposal moves file from pending to approved", () => {
  const tmp = withTmp();
  try {
    const r = enqueueProposal(tmp.outputsDir, { resourceType: "skills", name: "s", content: "c" });
    const after = approveProposal(tmp.outputsDir, r.id);
    assert.equal(after.status, "approved");
    assert.ok(after.resolvedAt);
    const paths = resolveProposalQueuePaths(tmp.outputsDir);
    assert.equal(existsSync(join(paths.pendingDir, `${r.id}.json`)), false);
    assert.equal(existsSync(join(paths.approvedDir, `${r.id}.json`)), true);
  } finally { tmp.cleanup(); }
});

test("rejectProposal records reason and moves to rejected", () => {
  const tmp = withTmp();
  try {
    const r = enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "t", content: "c" });
    const after = rejectProposal(tmp.outputsDir, r.id, "duplicate of existing X");
    assert.equal(after.status, "rejected");
    assert.equal(after.rejectReason, "duplicate of existing X");
    const paths = resolveProposalQueuePaths(tmp.outputsDir);
    assert.equal(existsSync(join(paths.rejectedDir, `${r.id}.json`)), true);
  } finally { tmp.cleanup(); }
});

test("rejectProposal requires non-empty reason", () => {
  const tmp = withTmp();
  try {
    const r = enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "t", content: "c" });
    assert.throws(() => rejectProposal(tmp.outputsDir, r.id, "   "));
  } finally { tmp.cleanup(); }
});

test("approveProposal throws when id missing in pending", () => {
  const tmp = withTmp();
  try {
    assert.throws(() => approveProposal(tmp.outputsDir, "prop-nonexistent"));
  } finally { tmp.cleanup(); }
});

test("getProposal finds across all status dirs", () => {
  const tmp = withTmp();
  try {
    const a = enqueueProposal(tmp.outputsDir, { resourceType: "skills", name: "a", content: "c" });
    const b = enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "b", content: "c" });
    approveProposal(tmp.outputsDir, b.id);
    assert.equal(getProposal(tmp.outputsDir, a.id)?.status, "pending");
    assert.equal(getProposal(tmp.outputsDir, b.id)?.status, "approved");
    assert.equal(getProposal(tmp.outputsDir, "prop-missing"), null);
  } finally { tmp.cleanup(); }
});

test("summarizeProposalQueue counts by status and resourceType", () => {
  const tmp = withTmp();
  try {
    const a = enqueueProposal(tmp.outputsDir, { resourceType: "skills", name: "a", content: "c" });
    const b = enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "b", content: "c" });
    enqueueProposal(tmp.outputsDir, { resourceType: "presets", name: "c", content: "c" });
    approveProposal(tmp.outputsDir, a.id);
    rejectProposal(tmp.outputsDir, b.id, "no");
    const s = summarizeProposalQueue(tmp.outputsDir);
    assert.equal(s.pending, 1);
    assert.equal(s.approved, 1);
    assert.equal(s.rejected, 1);
    assert.equal(s.byResourceType.skills.approved, 1);
    assert.equal(s.byResourceType.tools.rejected, 1);
    assert.equal(s.byResourceType.presets.pending, 1);
  } finally { tmp.cleanup(); }
});

test("listProposals prioritizes recent proposal when staleness is high", () => {
  const tmp = withTmp();
  try {
    enqueueProposal(
      tmp.outputsDir,
      { resourceType: "skills", name: "old", content: "c", confidence: 1 },
      new Date("2024-01-01T00:00:00.000Z")
    );
    enqueueProposal(
      tmp.outputsDir,
      { resourceType: "skills", name: "new", content: "c", confidence: 0.8 },
      new Date("2024-03-25T00:00:00.000Z")
    );

    const items = listProposals(tmp.outputsDir, {
      status: "pending",
      now: new Date("2024-03-25T00:00:00.000Z")
    });

    assert.equal(items[0]?.name, "new");
    assert.ok((items[0]?.priorityScore ?? -1) >= (items[1]?.priorityScore ?? -1));
  } finally { tmp.cleanup(); }
});

test("listProposals prioritizes higher acceptance-history proposal", () => {
  const tmp = withTmp();
  try {
    enqueueProposal(
      tmp.outputsDir,
      { resourceType: "skills", name: "high-rate", content: "c", confidence: 0.8 },
      new Date("2024-03-25T00:00:00.000Z")
    );
    enqueueProposal(
      tmp.outputsDir,
      { resourceType: "skills", name: "low-rate", content: "c", confidence: 0.8 },
      new Date("2024-03-25T00:00:00.000Z")
    );

    const items = listProposals(tmp.outputsDir, {
      status: "pending",
      now: new Date("2024-03-25T00:00:00.000Z"),
      historyAcceptRateByResource: {
        "skills:high-rate": 0.9,
        "skills:low-rate": 0.2
      }
    });

    assert.equal(items[0]?.name, "high-rate");
    assert.ok((items[0]?.priorityScore ?? -1) > (items[1]?.priorityScore ?? -1));
  } finally { tmp.cleanup(); }
});

test("executeListProposals auto-approves stale low-risk proposals", async () => {
  const tmp = withTmp();
  try {
    const proposalQueue = createFileProposalQueueStore(tmp.outputsDir);
    const pending = await proposalQueue.enqueue(
      {
        resourceType: "tools",
        name: "safe-change",
        content: JSON.stringify({ riskLevel: "low", summary: "minor update" })
      },
      new Date("2024-01-01T00:00:00.000Z")
    );

    const result = await executeListProposals({
      status: "pending",
      proposalQueue,
      approvalPolicy: {
        timeoutHours: 24,
        autoApprovalEnabled: true,
        lowRiskOnly: true,
        escalationTargets: ["PagerDuty", "Slack"]
      }
    });

    assert.equal((result as { approvalReview?: { autoApproved: number } }).approvalReview?.autoApproved, 1);
    assert.equal(await proposalQueue.get(pending.id).then((record) => record?.status), "approved");
    assert.equal((result as { items: unknown[] }).items.length, 0);
  } finally { tmp.cleanup(); }
});

test("approveProposalStage advances reviewer to admin and keeps pending", () => {
  const tmp = withTmp();
  try {
    const p = enqueueProposal(tmp.outputsDir, { resourceType: "skills", name: "multi", content: "c" });
    const afterReviewer = approveProposalStage(tmp.outputsDir, p.id, {
      stage: "reviewer",
      actor: "alice",
      comment: "looks good"
    });
    assert.equal(afterReviewer.status, "pending");
    assert.equal(afterReviewer.approval?.currentStage, "admin");
    assert.equal(afterReviewer.approval?.history.length, 1);

    const finalized = approveProposalStage(tmp.outputsDir, p.id, {
      stage: "admin",
      actor: "bob"
    });
    assert.equal(finalized.status, "approved");
    assert.ok(finalized.approval?.finalApprovedAt);
    assert.equal(finalized.approval?.history.length, 2);
  } finally { tmp.cleanup(); }
});

test("rejectProposalStage rejects from current stage with reason", () => {
  const tmp = withTmp();
  try {
    const p = enqueueProposal(tmp.outputsDir, { resourceType: "tools", name: "multi-reject", content: "c" });
    const rejected = rejectProposalStage(tmp.outputsDir, p.id, {
      stage: "reviewer",
      actor: "carol",
      reason: "risk too high"
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectReason, "risk too high");
    assert.equal(rejected.approval?.history.at(-1)?.decision, "rejected");
  } finally { tmp.cleanup(); }
});

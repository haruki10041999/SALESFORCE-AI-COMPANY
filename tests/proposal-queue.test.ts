import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
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
  summarizeProposalQueue,
  resolveProposalQueuePaths
} from "../mcp/core/resource/proposal-queue.js";

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

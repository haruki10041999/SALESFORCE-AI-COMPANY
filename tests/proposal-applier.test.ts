import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProposal, slugifyResourceName } from "../mcp/core/resource/proposal/applier.js";
import type { ProposalRecord } from "../mcp/core/resource/proposal/queue.js";

function withTmp(): { repoRoot: string; outputsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-applier-"));
  return {
    repoRoot: root,
    outputsDir: join(root, "outputs"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function rec(partial: Partial<ProposalRecord> & Pick<ProposalRecord, "resourceType" | "name" | "content">): ProposalRecord {
  return {
    id: partial.id ?? "prop-test",
    resourceType: partial.resourceType,
    name: partial.name,
    content: partial.content,
    confidence: partial.confidence ?? 0.9,
    status: partial.status ?? "pending",
    createdAt: partial.createdAt ?? new Date().toISOString()
  };
}

test("Phase2: slugifyResourceName normalizes input", () => {
  assert.equal(slugifyResourceName("Hello World"), "hello-world");
  assert.equal(slugifyResourceName("  Foo!! Bar  "), "foo-bar");
  assert.equal(slugifyResourceName("Apex_Service v2"), "apex-service-v2");
  assert.throws(() => slugifyResourceName("   "));
});

test("Phase2: applyProposal writes skill markdown", () => {
  const tmp = withTmp();
  try {
    const r = applyProposal(rec({ resourceType: "skills", name: "Auto Skill", content: "# title\nbody" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    assert.equal(r.applied, true);
    const expected = join(tmp.repoRoot, "skills", "auto-skill.md");
    assert.equal(r.filePath, expected);
    assert.equal(readFileSync(expected, "utf-8"), "# title\nbody");
  } finally { tmp.cleanup(); }
});

test("Phase2: applyProposal writes tool JSON with proposalId/slug", () => {
  const tmp = withTmp();
  try {
    const r = applyProposal(
      rec({ id: "prop-x", resourceType: "tools", name: "Demo Tool", content: JSON.stringify({ description: "d", agents: ["captain"] }) }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir }
    );
    assert.equal(r.applied, true);
    const data = JSON.parse(readFileSync(r.filePath, "utf-8"));
    // 新スキーマ準拠 (DeclarativeToolSpec)
    assert.equal(data.name, "demo-tool");
    assert.equal(data.proposalId, "prop-x");
    assert.equal(data.description, "d");
    assert.equal(data.action.kind, "compose-prompt");
    assert.deepEqual(data.action.agents, ["captain"]);
  } finally { tmp.cleanup(); }
});

test("Phase2: applyProposal writes preset v1.json + latest copy", () => {
  const tmp = withTmp();
  try {
    const r = applyProposal(rec({ resourceType: "presets", name: "Salesforce Review",
      content: JSON.stringify({ description: "d", topic: "review", agents: ["x"] }) }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    assert.equal(r.applied, true);
    assert.match(r.filePath, /presets[\\/]salesforce-review[\\/]v1\.json$/);
    assert.ok(existsSync(join(tmp.outputsDir, "presets", "salesforce-review.json")));
    // 2 回目は v2
    const r2 = applyProposal(rec({ resourceType: "presets", name: "Salesforce Review", content: "{}" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    assert.match(r2.filePath, /v2\.json$/);
  } finally { tmp.cleanup(); }
});

test("Phase2: applyProposal skips when file exists and overwrite=false", () => {
  const tmp = withTmp();
  try {
    const r1 = applyProposal(rec({ resourceType: "skills", name: "x", content: "v1" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    assert.equal(r1.applied, true);
    const r2 = applyProposal(rec({ resourceType: "skills", name: "x", content: "v2" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    assert.equal(r2.applied, false);
    assert.equal(r2.reason, "already-exists");
    assert.equal(readFileSync(r1.filePath, "utf-8"), "v1");
  } finally { tmp.cleanup(); }
});

test("Phase2: applyProposal overwrite=true replaces existing file", () => {
  const tmp = withTmp();
  try {
    applyProposal(rec({ resourceType: "skills", name: "x", content: "v1" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir });
    const r2 = applyProposal(rec({ resourceType: "skills", name: "x", content: "v2" }),
      { repoRoot: tmp.repoRoot, outputsDir: tmp.outputsDir, overwrite: true });
    assert.equal(r2.applied, true);
    assert.equal(readFileSync(r2.filePath, "utf-8"), "v2");
  } finally { tmp.cleanup(); }
});

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProposalQueueTools } from "../mcp/handlers/register-proposal-queue-tools.js";
import type { GovTool, GovToolResponse } from "../mcp/tool-types.js";

function withTmp(): { root: string; outputsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-proposal-tools-"));
  return {
    root,
    outputsDir: join(root, "outputs"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function parse(response: GovToolResponse): any {
  assert.equal(response.content[0]?.type, "text");
  const text = response.content[0]?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

test("approve_proposal applies resource by default", async () => {
  const tmp = withTmp();
  try {
    const handlers = new Map<string, (input: any) => Promise<GovToolResponse>>();
    const govTool: GovTool = (name, _config, handler) => {
      handlers.set(name, handler as (input: any) => Promise<GovToolResponse>);
    };
    registerProposalQueueTools({ govTool, repoRoot: tmp.root, outputsDir: tmp.outputsDir });

    const enqueue = handlers.get("enqueue_proposal");
    const approve = handlers.get("approve_proposal");
    assert.ok(enqueue);
    assert.ok(approve);

    const enqueued = parse(await enqueue!({
      resourceType: "skills",
      name: "One Step Skill",
      content: "# one-step\nbody",
      confidence: 0.9
    }));

    const proposalId = enqueued.enqueued.id;
    const approved = parse(await approve!({ id: proposalId }));

    assert.equal(approved.ok, true);
    assert.equal(approved.approved.status, "approved");
    assert.equal(approved.applied, true);
    assert.equal(approved.applyResult?.applied, true);
    assert.ok(existsSync(join(tmp.root, "skills", "one-step-skill.md")));
  } finally {
    tmp.cleanup();
  }
});

test("approve_proposal can skip apply with apply=false", async () => {
  const tmp = withTmp();
  try {
    const handlers = new Map<string, (input: any) => Promise<GovToolResponse>>();
    const govTool: GovTool = (name, _config, handler) => {
      handlers.set(name, handler as (input: any) => Promise<GovToolResponse>);
    };
    registerProposalQueueTools({ govTool, repoRoot: tmp.root, outputsDir: tmp.outputsDir });

    const enqueue = handlers.get("enqueue_proposal");
    const approve = handlers.get("approve_proposal");
    assert.ok(enqueue);
    assert.ok(approve);

    const enqueued = parse(await enqueue!({
      resourceType: "skills",
      name: "Approve Only Skill",
      content: "# approve-only\nbody",
      confidence: 0.8
    }));

    const proposalId = enqueued.enqueued.id;
    const approved = parse(await approve!({ id: proposalId, apply: false }));

    assert.equal(approved.ok, true);
    assert.equal(approved.approved.status, "approved");
    assert.equal(approved.applied, false);
    assert.equal(approved.applyResult, undefined);
    assert.equal(existsSync(join(tmp.root, "skills", "approve-only-skill.md")), false);
  } finally {
    tmp.cleanup();
  }
});

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveProposalStage,
  enqueueProposal,
  type NewProposalInput
} from "../../mcp/core/resource/proposal/queue.js";

function withTmp(): { outputsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-sod-"));
  return {
    outputsDir: join(root, "outputs"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function enqueueWithActor(outputsDir: string, input: Omit<NewProposalInput, "createdByActorId">, actorId: string) {
  return enqueueProposal(outputsDir, {
    ...input,
    createdByActorId: actorId
  });
}

test("SoD blocks reviewer when actor equals proposer", () => {
  const tmp = withTmp();
  try {
    const proposal = enqueueWithActor(tmp.outputsDir, {
      resourceType: "skills",
      name: "sod-reviewer",
      content: "content"
    }, "alice");

    assert.throws(() => {
      approveProposalStage(tmp.outputsDir, proposal.id, {
        stage: "reviewer",
        actor: "alice"
      });
    }, /SoD violation/);
  } finally {
    tmp.cleanup();
  }
});

test("SoD blocks admin when actor equals reviewer", () => {
  const tmp = withTmp();
  try {
    const proposal = enqueueWithActor(tmp.outputsDir, {
      resourceType: "tools",
      name: "sod-admin",
      content: "content"
    }, "proposer-1");

    approveProposalStage(tmp.outputsDir, proposal.id, {
      stage: "reviewer",
      actor: "reviewer-1"
    });

    assert.throws(() => {
      approveProposalStage(tmp.outputsDir, proposal.id, {
        stage: "admin",
        actor: "reviewer-1"
      });
    }, /SoD violation/);
  } finally {
    tmp.cleanup();
  }
});

test("SoD relax mode allows conflict and records marker in history", () => {
  const prev = process.env.SF_AI_SOD_RELAX_FOR_DEV;
  process.env.SF_AI_SOD_RELAX_FOR_DEV = "true";

  const tmp = withTmp();
  try {
    const proposal = enqueueWithActor(tmp.outputsDir, {
      resourceType: "presets",
      name: "sod-relax",
      content: "content"
    }, "same-actor");

    const afterReviewer = approveProposalStage(tmp.outputsDir, proposal.id, {
      stage: "reviewer",
      actor: "same-actor"
    });

    assert.equal(afterReviewer.status, "pending");
    assert.match(afterReviewer.approval?.history.at(-1)?.comment ?? "", /SOD_RELAX_FOR_DEV/);

    const final = approveProposalStage(tmp.outputsDir, proposal.id, {
      stage: "admin",
      actor: "same-actor"
    });

    assert.equal(final.status, "approved");
    assert.match(final.approval?.history.at(-1)?.comment ?? "", /SOD_RELAX_FOR_DEV/);
  } finally {
    if (prev === undefined) {
      delete process.env.SF_AI_SOD_RELAX_FOR_DEV;
    } else {
      process.env.SF_AI_SOD_RELAX_FOR_DEV = prev;
    }
    tmp.cleanup();
  }
});

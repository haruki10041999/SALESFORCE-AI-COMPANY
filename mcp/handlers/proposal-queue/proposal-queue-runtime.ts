import { resolve } from "node:path";
import { z } from "zod";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../../core/config/runtime-config.js";
import { OutputsArtifactWriter } from "../../core/persistence/outputs-artifact-writer.js";
import type { ProposalApprovalAudit } from "../../core/application/governance/services/proposal-queue-apply-operations.js";
import type { GovTool } from "../../tool-types.js";
import { createFileProposalQueueStore, type ProposalQueueStore } from "../../core/resource/proposal/proposal-queue-store.js";

export interface RegisterProposalQueueToolsDeps {
  govTool: GovTool;
  outputsDir?: string;
  repoRoot?: string;
  proposalQueue?: ProposalQueueStore;
}

export const RESOURCE_TYPE = z.enum(["skills", "tools", "presets"]);
export const STATUS = z.enum(["pending", "approved", "rejected"]);

export interface ProposalQueueRuntime {
  govTool: GovTool;
  outputsDir: string;
  repoRoot: string;
  proposalQueue: ProposalQueueStore;
  approvalAuditFile: string;
  appendApprovalAudit: (event: ProposalApprovalAudit) => Promise<void>;
}

export function createProposalQueueRuntime(deps: RegisterProposalQueueToolsDeps): ProposalQueueRuntime {
  const outputsDir = deps.outputsDir ?? resolve(getOutputsDir());
  const repoRoot = deps.repoRoot ?? resolve(".");
  const proposalQueue = deps.proposalQueue ?? createFileProposalQueueStore(outputsDir);
  const approvalAuditFile = resolve(outputsDir, "audit", "proposal-approvals.jsonl");
  const artifactWriter = new OutputsArtifactWriter({
    outputsDir,
    databaseUrl: getPrimaryDatabaseUrl()
  });

  const appendApprovalAudit = async (event: ProposalApprovalAudit): Promise<void> => {
    try {
      await artifactWriter.appendAuditArtifact(
        "proposal_approval",
        "presets",
        event,
        new Date().toISOString(),
        "audit/proposal-approvals.jsonl"
      );
    } catch {
      // Audit logging failures must not break tool execution.
    }
  };

  return {
    govTool: deps.govTool,
    outputsDir,
    repoRoot,
    proposalQueue,
    approvalAuditFile,
    appendApprovalAudit
  };
}

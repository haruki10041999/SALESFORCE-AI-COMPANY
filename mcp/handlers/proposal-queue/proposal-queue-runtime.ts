import { resolve } from "node:path";
import { z } from "zod";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import type { ProposalApprovalAudit } from "../../core/application/governance/services/proposal-queue-apply-operations.js";
import type { GovTool } from "../../tool-types.js";
import { createFileProposalQueueStore, type ProposalQueueStore } from "../../core/resource/proposal/proposal-queue-store.js";
import { withContextOutputsPort } from "../../core/runtime/with-context.js";

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
  const outputsPort = withContextOutputsPort(new LocalOutputsAdapter({ outputsDir }));

  const appendApprovalAudit = async (event: ProposalApprovalAudit): Promise<void> => {
    try {
      await outputsPort.appendEvent("audit/proposal-approvals.jsonl", {
        recordedAt: new Date().toISOString(),
        eventType: "proposal_approval",
        resourceType: "presets",
        ...event
      });
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

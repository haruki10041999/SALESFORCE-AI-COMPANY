import { z } from "zod";
import {
  executeApproveProposalStage,
  executeRejectProposalStage
} from "../../core/application/governance/services/proposal-queue-apply-operations.js";
import type { ApprovalStage } from "../../core/resource/proposal/queue.js";
import type { ProposalQueueRuntime } from "./proposal-queue-runtime.js";

export function registerProposalQueueStageTools(runtime: ProposalQueueRuntime): void {
  const { govTool, proposalQueue, appendApprovalAudit, approvalAuditFile } = runtime;

  govTool(
    "approve_proposal_stage",
    {
      title: "提案ステージ承認",
      description: "pending proposal を reviewer/admin の段階承認で進めます。最終ステージ承認時に approved へ遷移します。",
      inputSchema: {
        id: z.string().min(1).max(128),
        stage: z.enum(["reviewer", "admin"]),
        actor: z.string().min(1).max(128),
        comment: z.string().max(1000).optional()
      }
    },
    async ({ id, stage, actor, comment }: { id: string; stage: ApprovalStage; actor: string; comment?: string }) => {
      const result = await executeApproveProposalStage({
        id,
        stage,
        actor,
        comment,
        proposalQueue,
        appendApprovalAudit,
        approvalAuditFile
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );

  govTool(
    "reject_proposal_stage",
    {
      title: "提案ステージ却下",
      description: "pending proposal を reviewer/admin の任意ステージで却下し、rejected へ遷移します。",
      inputSchema: {
        id: z.string().min(1).max(128),
        stage: z.enum(["reviewer", "admin"]),
        actor: z.string().min(1).max(128),
        reason: z.string().min(1).max(1000)
      }
    },
    async ({ id, stage, actor, reason }: { id: string; stage: ApprovalStage; actor: string; reason: string }) => {
      const result = await executeRejectProposalStage({
        id,
        stage,
        actor,
        reason,
        proposalQueue,
        appendApprovalAudit,
        approvalAuditFile
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );
}

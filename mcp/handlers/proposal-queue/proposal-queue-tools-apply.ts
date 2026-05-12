import { z } from "zod";
import {
  executeApproveProposal,
  executeApplyProposal,
  executeAutoApplyPendingProposals,
  executeRejectProposal
} from "../../core/application/governance/services/proposal-queue-apply-operations.js";
import type { ProposalResourceType } from "../../core/resource/proposal/queue.js";
import { RESOURCE_TYPE, type ProposalQueueRuntime } from "./proposal-queue-runtime.js";

export function registerProposalQueueApplyTools(runtime: ProposalQueueRuntime): void {
  const { govTool, repoRoot, outputsDir, proposalQueue, appendApprovalAudit } = runtime;

  govTool(
    "approve_proposal",
    {
      title: "提案を承認 (既定で即時適用)",
      description: "保留中の提案を approved/ に移動します。既定では提案内容も即時適用します（apply=false で従来の承認のみ運用に戻せます）。",
      inputSchema: {
        id: z.string().min(1).max(128),
        apply: z.boolean().optional(),
        overwrite: z.boolean().optional()
      }
    },
    async ({ id, apply, overwrite }: { id: string; apply?: boolean; overwrite?: boolean }) => {
      const result = await executeApproveProposal({
        id,
        apply,
        overwrite,
        repoRoot,
        outputsDir,
        proposalQueue,
        appendApprovalAudit
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
    "reject_proposal",
    {
      title: "提案を却下",
      description: "保留中の提案を rejected/ に移動します。理由は監査ログとしてレコードに記録されます。",
      inputSchema: {
        id: z.string().min(1).max(128),
        reason: z.string().min(1).max(500)
      }
    },
    async ({ id, reason }: { id: string; reason: string }) => {
      const result = await executeRejectProposal({
        id,
        reason,
        proposalQueue,
        appendApprovalAudit
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  govTool(
    "apply_proposal",
    {
      title: "提案を承認＋実適用",
      description: "保留中の提案を実適用します。skills は常に skills/<name>.md に反映されます。tools/presets の file 反映は既定無効で、SF_AI_CUSTOM_TOOL_FILE_FALLBACK=true / SF_AI_PRESET_FILE_FALLBACK=true の場合のみ outputs/custom-tools または outputs/presets に書き込みます。overwrite=false の場合、既存ファイルがあれば適用をスキップします。",
      inputSchema: {
        id: z.string().min(1).max(128),
        overwrite: z.boolean().optional()
      }
    },
    async ({ id, overwrite }: { id: string; overwrite?: boolean }) => {
      const result = await executeApplyProposal({
        id,
        overwrite,
        repoRoot,
        outputsDir,
        proposalQueue
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "auto_apply_pending_proposals",
    {
      title: "保留提案の自動承認バッチ",
      description: "pending の提案を AutoCreateGate (resourceType ごとの enabled / threshold / maxPerDay) で評価し、通過したものだけを自動適用します。既定はすべて OFF (明示 opt-in が必要)。dryRun=true で適用せずに判定だけ確認できます。",
      inputSchema: {
        config: z.object({
          skills: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional(),
          tools: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional(),
          presets: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional()
        }).optional(),
        denyList: z.array(z.object({
          resourceType: RESOURCE_TYPE,
          name: z.string().min(1).max(128)
        })).optional(),
        dryRun: z.boolean().optional(),
        overwrite: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ config, denyList, dryRun, overwrite, limit }: {
      config?: Parameters<typeof executeAutoApplyPendingProposals>[0]["config"];
      denyList?: Array<{ resourceType: ProposalResourceType; name: string }>;
      dryRun?: boolean;
      overwrite?: boolean;
      limit?: number;
    }) => {
      const result = await executeAutoApplyPendingProposals({
        config,
        denyList,
        dryRun,
        overwrite,
        limit,
        repoRoot,
        outputsDir,
        proposalQueue
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

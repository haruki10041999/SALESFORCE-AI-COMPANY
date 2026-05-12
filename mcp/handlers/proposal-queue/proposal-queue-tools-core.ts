import { resolve } from "node:path";
import { z } from "zod";
import { currentActor } from "../../core/identity/actor-context.js";
import { loadProposalFeedbackModel } from "../../core/resource/proposal-feedback.js";
import {
  executeEnqueueProposal,
  executeGetProposal,
  executeListProposals
} from "../../core/application/governance/services/proposal-queue-apply-operations.js";
import type { ProposalResourceType, ProposalStatus } from "../../core/resource/proposal/queue.js";
import { RESOURCE_TYPE, STATUS, type ProposalQueueRuntime } from "./proposal-queue-runtime.js";

export function registerProposalQueueCoreTools(runtime: ProposalQueueRuntime): void {
  const { govTool, outputsDir, proposalQueue } = runtime;

  govTool(
    "enqueue_proposal",
    {
      title: "リソース提案キューへ追加",
      description: "新規 skill / tool / preset の作成提案を outputs/tool-proposals/pending/ に永続化します。承認は approve_proposal、却下は reject_proposal で行います。",
      inputSchema: {
        resourceType: RESOURCE_TYPE,
        name: z.string().min(1).max(128),
        content: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        sourceEvent: z.string().min(1).max(128).optional(),
        origin: z.string().min(1).max(128).optional()
      }
    },
    async ({ resourceType, name, content, confidence, sourceEvent, origin }: {
      resourceType: ProposalResourceType;
      name: string;
      content: string;
      confidence?: number;
      sourceEvent?: string;
      origin?: string;
    }) => {
      const actor = currentActor();
      const result = await executeEnqueueProposal({
        resourceType,
        name,
        content,
        confidence,
        sourceEvent,
        origin,
        proposalQueue,
        createdByActorId: actor.id
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  govTool(
    "list_proposals",
    {
      title: "リソース提案一覧",
      description: "保留 / 承認済 / 却下済の提案を一覧します。status を省略すると全状態を返します。",
      inputSchema: {
        status: STATUS.optional(),
        resourceType: RESOURCE_TYPE.optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ status, resourceType, limit }: { status?: ProposalStatus; resourceType?: ProposalResourceType; limit?: number }) => {
      const feedbackModel = await loadProposalFeedbackModel(resolve(outputsDir, "tool-proposals", "proposal-feedback-model.json"));
      const historyAcceptRateByResource = feedbackModel
        ? Object.fromEntries(feedbackModel.resources.map((row) => [`${row.resourceType}:${row.name}`, row.acceptRate]))
        : undefined;
      const result = await executeListProposals({
        status,
        resourceType,
        limit,
        proposalQueue,
        historyAcceptRateByResource
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  govTool(
    "get_proposal",
    {
      title: "提案詳細取得",
      description: "ID で提案 1 件の詳細を返します。状態を問わず検索します。",
      inputSchema: {
        id: z.string().min(1).max(128)
      }
    },
    async ({ id }: { id: string }) => {
      const result = await executeGetProposal({ id, proposalQueue });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}

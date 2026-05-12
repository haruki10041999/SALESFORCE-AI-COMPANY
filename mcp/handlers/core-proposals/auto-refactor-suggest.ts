import { z } from "zod";
import { resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import { executeAutoRefactorSuggest } from "../../core/application/governance/services/resource-auto-refactor-suggest.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { ProposalQueueStore } from "../../core/resource/proposal/proposal-queue-store.js";

export interface DefineAutoRefactorSuggestDeps extends RegisterGovToolDeps {
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  proposalQueue: ProposalQueueStore;
}

export function defineAutoRefactorSuggestTool(deps: DefineAutoRefactorSuggestDeps): void {
  const { govTool, emitSystemEvent, proposalQueue } = deps;
  const outputsDir = resolve(getOutputsDir());
  const skillRatingLogFile = resolve(outputsDir, "reports", "skill-rating.jsonl");

  govTool(
    "auto_refactor_suggest",
    {
      title: "自動リファクタリング提案",
      description: "accept rate が低下したスキルを検出し、refactor_suggest を自動実行して proposal queue に保存します。",
      inputSchema: z.object({
        declineThreshold: z.number().min(0).max(1).optional(),
        days: z.number().int().min(1).max(90).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        respectSchedule: z.boolean().optional(),
        at: z.string().optional()
      })
    },
    async ({ declineThreshold, days, limit, respectSchedule, at }: {
      declineThreshold?: number;
      days?: number;
      limit?: number;
      respectSchedule?: boolean;
      at?: string;
    }) => {
      const payload = await executeAutoRefactorSuggest({
        declineThreshold,
        days,
        limit,
        respectSchedule,
        at,
        outputsDir,
        skillRatingLogFile,
        proposalQueue,
        emitSystemEvent
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }]
      };
    }
  );
}

import { z } from "zod";
import type { TriggerRule } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";
import { endTrace, failTrace, startTrace } from "../../core/trace/trace-context.js";
import {
  getAgentTrustThreshold
} from "../../core/config/runtime-config.js";
import {
  executeEvaluateTriggersTool
} from "../../core/application/chat/services/chat-orchestration-trigger-tool.js";
import { buildSessionNotFoundText } from "../../core/application/chat/services/chat-orchestration-responses.js";
import type { SessionStore } from "../../core/persistence/session-store.js";
import type { OrchestrationQueueStore } from "../../infrastructure/workflow/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../../infrastructure/workflow/orchestration-job-runner.js";
import type { WorkflowEngine } from "../../core/ports/workflow-engine.js";

export interface DefineEvaluateTriggersDeps extends RegisterGovToolDeps {
  triggerRuleSchema: z.ZodTypeAny;
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  workflowEngine: WorkflowEngine;
  getSessionOrRestore: (sessionId: string) => Promise<any>;
}

export function defineEvaluateTriggersTool(deps: DefineEvaluateTriggersDeps): void {
  const {
    govTool,
    triggerRuleSchema,
    evaluatePseudoHooks,
    emitSystemEvent,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    getSessionOrRestore
  } = deps;

  govTool(
    "evaluate_triggers",
    {
      title: "トリガー評価（疑似フック）",
      description: "疑似フックのトリガールールを評価します。",
      inputSchema: {
        sessionId: z.string().optional(),
        lastAgent: z.string(),
        lastMessage: z.string(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        fallbackRoundRobin: z.boolean().optional(),
        enableTrustScoring: z.boolean().optional(),
        trustThreshold: z.number().min(0).max(1).optional(),
        agentFeedback: z.enum(["accept", "reject", "neutral"]).optional(),
        maxEscalations: z.number().int().min(1).max(3).optional()
      }
    },
    async ({ sessionId, lastAgent, lastMessage, triggerRules, fallbackRoundRobin, enableTrustScoring, trustThreshold, agentFeedback, maxEscalations }: {
      sessionId?: string;
      lastAgent: string;
      lastMessage: string;
      triggerRules?: TriggerRule[];
      fallbackRoundRobin?: boolean;
      enableTrustScoring?: boolean;
      trustThreshold?: number;
      agentFeedback?: "accept" | "reject" | "neutral";
      maxEscalations?: number;
    }) => {
      const result = await executeEvaluateTriggersTool({
        sessionId,
        lastAgent,
        lastMessage,
        triggerRules,
        fallbackRoundRobin,
        enableTrustScoring,
        trustThreshold: trustThreshold ?? getAgentTrustThreshold(),
        agentFeedback,
        maxEscalations,
        evaluatePseudoHooks,
        getSessionOrRestore,
        buildSessionNotFoundText,
        replaceQueue: (targetSessionId, queue) => orchestrationQueueStore.replace(targetSessionId, queue),
        workflowEngine,
        upsertSession: (session) => sessionStore.upsert(session, -1),
        emitSystemEvent,
        startTrace,
        endTrace,
        failTrace
      });

      if (result.notFoundText) {
        return {
          content: [{ type: "text", text: result.notFoundText }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result.response ?? {}, null, 2) }]
      };
    }
  );
}

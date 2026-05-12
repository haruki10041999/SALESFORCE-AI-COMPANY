import { z } from "zod";
import type { TriggerRule } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";
import { endTrace, failTrace, startTrace, withPhase } from "../../core/trace/trace-context.js";
import {
  executeOrchestrateChatTool
} from "../../core/application/chat/services/chat-orchestration-start.js";
import type { SessionStore } from "../../core/persistence/session-store.js";
import type { OrchestrationQueueStore } from "../../core/orchestration/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../../core/orchestration/job-runner.js";
import type { DagNode } from "../../core/orchestration/dag-engine.js";

export interface DefineOrchestrateChatchDeps extends RegisterGovToolDeps {
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string
  ) => Promise<string>;
  generateSessionId: () => string;
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  liveSessionCache: Map<string, any>;
}

export function defineOrchestrateChatTool(deps: DefineOrchestrateChatchDeps): void {
  const {
    govTool,
    triggerRuleSchema,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    generateSessionId,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    liveSessionCache
  } = deps;

  govTool(
    "orchestrate_chat",
    {
      title: "オーケストレーションチャット（疑似フック）",
      description: "疑似フックを使ったオーケストレーションチャットを実行します。",
      inputSchema: {
        topic: z.string(),
        filePaths: z.array(z.string()).optional(),
        agents: z.array(z.string()).optional(),
        dagNodes: z.array(
          z.object({
            id: z.string().min(1),
            dependsOn: z.array(z.string().min(1)).optional()
          })
        ).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        turns: z.number().int().min(1).max(30).optional(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional()
      }
    },
    async ({ topic, filePaths, agents, dagNodes, persona, skills, turns, triggerRules, maxContextChars, appendInstruction }: {
      topic: string;
      filePaths?: string[];
      agents?: string[];
      dagNodes?: DagNode[];
      persona?: string;
      skills?: string[];
      turns?: number;
      triggerRules?: TriggerRule[];
      maxContextChars?: number;
      appendInstruction?: string;
    }) => {
      const response = await executeOrchestrateChatTool({
        topic,
        filePaths,
        agents,
        dagNodes,
        persona,
        skills,
        turns,
        triggerRules,
        maxContextChars,
        appendInstruction,
        generateSessionId,
        filterDisabledSkills,
        emitSystemEvent,
        buildChatPrompt,
        setLiveSession: (id, live) => {
          liveSessionCache.set(id, live);
        },
        upsertSession: (targetSession) => sessionStore.upsert(targetSession, -1),
        replaceQueue: (targetSessionId, queue) => orchestrationQueueStore.replace(targetSessionId, queue),
        enqueueStep: (input) => orchestrationJobRunner.enqueueStep(input),
        startTrace,
        withPhase,
        endTrace,
        failTrace
      });

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
      };
    }
  );
}

import { join } from "node:path";
import { z } from "zod";
import type { TriggerRule, AgentMessage, OrchestrationSession } from "../core/types/index.js";
import type { SessionStore } from "../core/persistence/session-store.js";
import type { OrchestrationQueueStore } from "../infrastructure/workflow/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../infrastructure/workflow/orchestration-job-runner.js";
import type { WorkflowEngine } from "../core/ports/workflow-engine.js";
import type { RegisterGovToolDeps } from "./types.js";
import { defineChatTool } from "./core-chat-basic/chat.js";
import { defineSimulateChatTool } from "./core-chat-basic/simulate-chat.js";
import { defineOrchestrateChatTool } from "./core-chat-engine/orchestrate-chat.js";
import { defineEvaluateTriggersTool } from "./core-chat-engine/evaluate-triggers.js";
import { defineDequeueNextAgentTool } from "./core-chat-engine/dequeue-next-agent.js";
import { defineGetOrchestrationSessionTool } from "./core-chat-session/get-orchestration-session.js";
import { defineSaveOrchestrationSessionTool } from "./core-chat-session/save-orchestration-session.js";
import { defineRestoreOrchestrationSessionTool } from "./core-chat-session/restore-orchestration-session.js";
import { defineListOrchestrationSessionsTool } from "./core-chat-session/list-orchestration-sessions.js";
import { executeGetSessionOrRestore } from "../core/application/chat/services/chat-orchestration-session-retrieval.js";
import {
  projectWorkflowStepsToStoredEvents,
  summarizeWorkflowEventProjection,
  type WorkflowEventProjectionSummary
} from "../infrastructure/workflow/temporal-workflow-event-projection.js";

interface RegisterChatOrchestrationToolsDeps extends RegisterGovToolDeps {
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  generateSessionId: () => string;
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
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  workflowEngine: WorkflowEngine;
  policySnapshotManager?: {
    current?: { version: number } | null;
    isLive?: boolean;
    reputationScores?: (agents: string[], topic: string) => Map<string, number>;
  };
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  onSessionCompleted?: (input: {
    sessionId: string;
    topic: string;
    history: AgentMessage[];
  }) => Promise<{ entities: number; relations: number } | null>;
  outputsDir: string;
}

export function registerChatOrchestrationTools(deps: RegisterChatOrchestrationToolsDeps): void {
  const {
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    outputsDir
  } = deps;

  // In-process cache for active sessions (avoids repeated DB reads during a single orchestration)
  const liveSessionCache = new Map<string, OrchestrationSession | undefined>();

  async function getSessionOrRestore(sessionId: string): Promise<OrchestrationSession | undefined> {
    return executeGetSessionOrRestore({
      sessionId,
      sessionStore,
      orchestrationQueueStore,
      liveSessionCache,
      workflowEngine
    });
  }

  async function getWorkflowEventProjection(
    sessionId: string
  ): Promise<WorkflowEventProjectionSummary | undefined> {
    try {
      const state = await workflowEngine.query(sessionId);
      const events = projectWorkflowStepsToStoredEvents({
        sessionId,
        steps: state.steps
      });
      return summarizeWorkflowEventProjection({ sessionId, events });
    } catch {
      return undefined;
    }
  }

  // core-chat-basic
  defineChatTool({ ...deps, chatInputSchema, runChatTool });
  defineSimulateChatTool({ ...deps, chatInputSchema, runChatTool });

  // core-chat-engine
  defineOrchestrateChatTool({
    ...deps,
    triggerRuleSchema,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    generateSessionId,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    liveSessionCache
  });
  defineEvaluateTriggersTool({
    ...deps,
    triggerRuleSchema,
    evaluatePseudoHooks,
    emitSystemEvent,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    getSessionOrRestore
  });
  defineDequeueNextAgentTool({
    ...deps,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    workflowEngine,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    outputsDir,
    liveSessionCache
  });

  // core-chat-session
  defineGetOrchestrationSessionTool({ ...deps, getSessionOrRestore, getWorkflowEventProjection });
  defineSaveOrchestrationSessionTool({ ...deps, getSessionOrRestore, sessionStore });
  defineRestoreOrchestrationSessionTool({
    ...deps,
    sessionStore,
    liveSessionCache,
    getSessionOrRestore,
    getWorkflowEventProjection
  });
  defineListOrchestrationSessionsTool({ ...deps, sessionStore, getWorkflowEventProjection });
}




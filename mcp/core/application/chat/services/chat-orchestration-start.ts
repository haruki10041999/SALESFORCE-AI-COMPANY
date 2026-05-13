import type { OrchestrationSession } from "../../../types/index.js";
import type { TriggerRule } from "../../../types/index.js";
import { buildDagExecutionLayers, type DagNode } from "../../../orchestration/dag-engine.js";

export interface OrchestrationPlan {
  selectedAgents: string[];
  dagLayers: string[][];
  initialQueue: string[];
  orchestrationMode: "dag" | "linear";
}

export function buildOrchestrationPlan(args: {
  dagNodes?: DagNode[];
  agents?: string[];
  defaultAgents?: string[];
}): OrchestrationPlan {
  const selectedAgents = args.dagNodes && args.dagNodes.length > 0
    ? [...new Set(args.dagNodes.map((node) => node.id))]
    : (args.agents ?? args.defaultAgents ?? ["product-manager", "architect", "qa-engineer"]);
  const dagLayers = args.dagNodes && args.dagNodes.length > 0
    ? buildDagExecutionLayers(args.dagNodes)
    : [];
  const initialQueue = dagLayers.length > 0 ? dagLayers.flat() : [...selectedAgents];

  return {
    selectedAgents,
    dagLayers,
    initialQueue,
    orchestrationMode: dagLayers.length > 0 ? "dag" : "linear"
  };
}

export function buildInitialOrchestrationSession(args: {
  sessionId: string;
  topic: string;
  appendInstruction?: string;
  selectedAgents: string[];
  persona?: string;
  enabledSkills: string[];
  filePaths: string[];
  turns: number;
  triggerRules: TriggerRule[];
  initialQueue: string[];
  dagNodes?: DagNode[];
  dagLayers: string[][];
}): OrchestrationSession {
  return {
    id: args.sessionId,
    topic: args.topic,
    appendInstruction: args.appendInstruction,
    agents: args.selectedAgents,
    persona: args.persona,
    skills: args.enabledSkills,
    filePaths: args.filePaths,
    turns: args.turns,
    triggerRules: args.triggerRules,
    queue: args.initialQueue,
    history: [],
    firedRules: [],
    dag: args.dagLayers.length > 0
      ? {
        enabled: true,
        nodes: args.dagNodes ?? [],
        layers: args.dagLayers
      }
      : undefined,
    agentTrust: {}
  };
}

export async function persistInitialOrchestrationSession(args: {
  session: OrchestrationSession;
  setLiveSession: (sessionId: string, session: OrchestrationSession) => void;
  upsertSession: (session: OrchestrationSession) => Promise<unknown>;
  replaceQueue: (sessionId: string, queue: string[]) => Promise<unknown>;
  workflowEngine: {
    enqueue(input: {
      sessionId: string;
      topic: string;
      agents: string[];
      turns?: number;
    }): Promise<void>;
  };
  mode: "dag" | "linear";
}): Promise<void> {
  args.setLiveSession(args.session.id, args.session);
  await args.upsertSession(args.session);
  await args.replaceQueue(args.session.id, args.session.queue);

  await args.workflowEngine.enqueue({
    sessionId: args.session.id,
    topic: args.session.topic,
    agents: args.session.queue,
    turns: args.session.turns
  });
}

export function buildOrchestrateChatResponse(args: {
  sessionId: string;
  orchestrationMode: "dag" | "linear";
  nextQueue: string[];
  triggerRuleCount: number;
  dagLayers: string[][];
  disabledSkills: string[];
  prompt: string;
}): Record<string, unknown> {
  return {
    sessionId: args.sessionId,
    mode: "pseudo-hook",
    orchestrationMode: args.orchestrationMode,
    nextQueue: args.nextQueue,
    queueProgress: {
      total: args.nextQueue.length,
      executed: 0,
      remaining: args.nextQueue.length,
      currentAgent: args.nextQueue[0] ?? null
    },
    triggerRuleCount: args.triggerRuleCount,
    dagLayers: args.dagLayers.length > 0 ? args.dagLayers : undefined,
    disabledSkills: args.disabledSkills,
    prompt: args.prompt
  };
}

export async function executeOrchestrateChatTool(args: {
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
  setLiveSession: (sessionId: string, session: OrchestrationSession) => void;
  upsertSession: (session: OrchestrationSession) => Promise<unknown>;
  replaceQueue: (sessionId: string, queue: string[]) => Promise<unknown>;
  workflowEngine: {
    enqueue(input: {
      sessionId: string;
      topic: string;
      agents: string[];
      turns?: number;
    }): Promise<void>;
  };
  startTrace: (name: string, attrs?: Record<string, unknown>) => string;
  withPhase: <T>(
    traceId: string,
    phase: "input" | "plan" | "execute" | "render",
    fn: () => Promise<T>
  ) => Promise<T>;
  endTrace: (traceId: string, attrs?: Record<string, unknown>) => void;
  failTrace: (traceId: string, err: unknown, attrs?: Record<string, unknown>) => void;
}): Promise<Record<string, unknown>> {
  const orchestrationPlan = buildOrchestrationPlan({
    dagNodes: args.dagNodes,
    agents: args.agents,
    defaultAgents: ["product-manager", "architect", "qa-engineer"]
  });
  const { selectedAgents, dagLayers, initialQueue, orchestrationMode } = orchestrationPlan;
  const sessionId = args.generateSessionId();
  const traceId = args.startTrace("orchestrate_chat", {
    agent: selectedAgents[0],
    skills: args.skills,
    topic: args.topic
  });

  try {
    const { enabled: enabledSkills, disabled: disabledSkills } = await args.withPhase(
      traceId,
      "input",
      () => args.filterDisabledSkills(args.skills ?? [])
    );

    await args.withPhase(traceId, "plan", async () => {
      await args.emitSystemEvent("session_start", {
        sessionId,
        topic: args.topic,
        agents: selectedAgents,
        triggerRuleCount: (args.triggerRules ?? []).length,
        requestedSkills: args.skills ?? [],
        enabledSkills,
        disabledSkills
      });
      return true;
    });

    const prompt = await args.withPhase(traceId, "execute", () =>
      args.buildChatPrompt(
        args.topic,
        selectedAgents,
        args.persona,
        enabledSkills,
        args.filePaths ?? [],
        args.turns ?? 6,
        args.maxContextChars,
        args.appendInstruction
      )
    );

    const session: OrchestrationSession = buildInitialOrchestrationSession({
      sessionId,
      topic: args.topic,
      appendInstruction: args.appendInstruction,
      selectedAgents,
      persona: args.persona,
      enabledSkills,
      filePaths: args.filePaths ?? [],
      turns: args.turns ?? 6,
      triggerRules: args.triggerRules ?? [],
      initialQueue,
      dagNodes: args.dagNodes,
      dagLayers
    });

    await args.withPhase(traceId, "render", async () => {
      await persistInitialOrchestrationSession({
        session,
        setLiveSession: args.setLiveSession,
        upsertSession: args.upsertSession,
        replaceQueue: args.replaceQueue,
        workflowEngine: args.workflowEngine,
        mode: orchestrationMode
      });
      return true;
    });

    args.endTrace(traceId, { agentCount: selectedAgents.length });
    return buildOrchestrateChatResponse({
      sessionId,
      orchestrationMode,
      nextQueue: session.queue,
      triggerRuleCount: session.triggerRules.length,
      dagLayers,
      disabledSkills,
      prompt
    });
  } catch (err) {
    args.failTrace(traceId, err);
    throw err;
  }
}
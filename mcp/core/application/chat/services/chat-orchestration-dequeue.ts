import type { AgentMessage, OrchestrationSession } from "../../../types/index.js";
import {
  buildAgentTransitionModel,
  loadAgentGraphRecords,
  recommendNextAgents,
  recordAgentSequence
} from "../../../learning/agent-graph-learner.js";

export interface GraphRecommendation {
  fromAgent: string;
  recommendedAgent: string;
  probability: number;
}

export async function applyAgentGraphRecommendation(args: {
  session: OrchestrationSession;
  agentGraphFile: string;
}): Promise<GraphRecommendation | null> {
  const { session, agentGraphFile } = args;

  const lastAgentInHistory = session.history.at(-1)?.agent;
  const executedApprox = Math.max(0, session.agents.length - session.queue.length);
  const fallbackFromAgent = executedApprox > 0
    ? session.agents[Math.min(session.agents.length - 1, executedApprox - 1)]
    : undefined;
  const fromAgent = lastAgentInHistory ?? fallbackFromAgent;
  if (!fromAgent || session.queue.length === 0) {
    return null;
  }

  const graphRecords = await loadAgentGraphRecords(agentGraphFile);
  const graphModel = buildAgentTransitionModel(graphRecords);
  const recommendations = recommendNextAgents({
    model: graphModel,
    fromAgent,
    candidates: session.queue,
    limit: 1
  });
  const top = recommendations[0];
  if (!top) {
    return null;
  }

  const idx = session.queue.findIndex((agent) => agent === top.to);
  if (idx > 0) {
    const [selected] = session.queue.splice(idx, 1);
    session.queue.unshift(selected);
  }

  return {
    fromAgent: top.from,
    recommendedAgent: top.to,
    probability: top.probability
  };
}

export async function finalizeSessionWhenQueueEmpty(args: {
  sessionId: string;
  session: OrchestrationSession;
  agentGraphFile: string;
  persistSession: (session: OrchestrationSession) => Promise<{ filePath: string } | null>;
  removeLiveSessionCache: (sessionId: string) => void;
  clearQueue: (sessionId: string) => Promise<void>;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  onSessionCompleted?: (input: {
    sessionId: string;
    topic: string;
    history: AgentMessage[];
  }) => Promise<{ entities: number; relations: number } | null>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  if (args.session.queue.length > 0) {
    return;
  }

  const learned = await recordAgentSequence(args.agentGraphFile, {
    sessionId: args.sessionId,
    sequence: args.session.history.map((item) => item.agent),
    success: true
  });
  const savedSession = await args.persistSession(args.session);
  args.removeLiveSessionCache(args.sessionId);
  await args.clearQueue(args.sessionId);
  const savedHistoryId = args.session.history.length > 0
    ? await args.saveSessionHistory(args.session.topic, args.session.history)
    : null;
  const knowledgeGraph = args.onSessionCompleted
    ? await args.onSessionCompleted({
      sessionId: args.sessionId,
      topic: args.session.topic,
      history: args.session.history
    })
    : null;

  await args.emitSystemEvent("session_end", {
    sessionId: args.sessionId,
    topic: args.session.topic,
    reason: "queue-empty",
    historyCount: args.session.history.length,
    firedRuleCount: args.session.firedRules.length,
    graphLearned: learned !== null,
    autoSavedSessionPath: savedSession?.filePath ?? null,
    autoSavedHistoryId: savedHistoryId,
    knowledgeGraph
  });
}

export function buildDequeueNextAgentResponse(args: {
  sessionId: string;
  dequeued: string[];
  remainingQueue: string[];
  graphRecommendation: GraphRecommendation | null;
  snapshotVersion: number | null;
  totalAgents: number;
}): Record<string, unknown> {
  return {
    sessionId: args.sessionId,
    dequeued: args.dequeued,
    remainingQueue: args.remainingQueue,
    graphRecommendation: args.graphRecommendation,
    snapshotVersion: args.snapshotVersion,
    queueProgress: {
      total: args.totalAgents,
      executed: args.totalAgents - args.remainingQueue.length,
      remaining: args.remainingQueue.length,
      currentAgent: args.dequeued[0] ?? null,
      nextAgent: args.remainingQueue[0] ?? null
    }
  };
}
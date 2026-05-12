import type { AgentMessage, OrchestrationSession } from "../../../types/index.js";
import type { SessionStore } from "../../../persistence/session-store.js";
import type { PolicySnapshotManager } from "../../../learning/policy-snapshot.js";
import {
  applyAgentGraphRecommendation,
  buildDequeueNextAgentResponse,
  finalizeSessionWhenQueueEmpty
} from "./chat-orchestration-dequeue.js";
import {
  getSessionOrRestore,
  persistOrchestrationSession,
  prioritizeQueueByPolicy
} from "./chat-orchestration-session.js";

export async function executeDequeueNextAgentTool(args: {
  sessionId: string;
  limit?: number;
  liveSessionCache: Map<string, OrchestrationSession>;
  sessionStore: SessionStore;
  orchestrationQueueStore: {
    replace: (sessionId: string, queue: string[]) => Promise<void>;
    dequeue: (sessionId: string, limit: number) => Promise<string[]>;
    clear: (sessionId: string) => Promise<void>;
  };
  orchestrationJobRunner: {
    markDequeued: (sessionId: string, agent: string) => Promise<unknown>;
    completeLatestRunningStep: (input: {
      sessionId: string;
      agent: string;
      output?: unknown;
      checkpoint?: Record<string, unknown>;
      status?: "completed" | "failed";
    }) => Promise<unknown>;
  };
  policySnapshotManager?: PolicySnapshotManager;
  agentGraphFile: string;
  agentReputationFile: string;
  buildSessionNotFoundText: (sessionId: string) => string;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  onSessionCompleted?: (input: {
    sessionId: string;
    topic: string;
    history: AgentMessage[];
  }) => Promise<{ entities: number; relations: number } | null>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await getSessionOrRestore({
    sessionId: args.sessionId,
    liveSessionCache: args.liveSessionCache,
    sessionStore: args.sessionStore,
    replaceQueue: (targetSessionId, queue) => args.orchestrationQueueStore.replace(targetSessionId, queue)
  });
  if (!session) {
    return { notFoundText: args.buildSessionNotFoundText(args.sessionId) };
  }

  const graphRecommendation = await applyAgentGraphRecommendation({
    session,
    agentGraphFile: args.agentGraphFile
  });

  let snapshotVersion: number | null = null;
  if (session.queue.length > 1) {
    const result = await prioritizeQueueByPolicy({
      queue: session.queue,
      topic: session.topic,
      policySnapshotManager: args.policySnapshotManager,
      agentReputationFile: args.agentReputationFile
    });
    session.queue = result.ordered;
    snapshotVersion = result.snapshotVersion;
  }

  await args.orchestrationQueueStore.replace(session.id, session.queue);

  const take = args.limit ?? 1;
  const nextAgents = await args.orchestrationQueueStore.dequeue(session.id, take);
  for (const agent of nextAgents) {
    await args.orchestrationJobRunner.markDequeued(session.id, agent);
  }
  for (const agent of nextAgents) {
    const index = session.queue.indexOf(agent);
    if (index >= 0) {
      session.queue.splice(index, 1);
    }
  }

  await args.sessionStore.upsert(session, -1);

  for (const agent of nextAgents) {
    await args.orchestrationJobRunner.completeLatestRunningStep({
      sessionId: session.id,
      agent,
      output: {
        dequeued: true,
        remainingQueue: session.queue.length
      },
      checkpoint: {
        queueLength: session.queue.length,
        currentAgent: agent
      }
    });
  }

  await finalizeSessionWhenQueueEmpty({
    sessionId: args.sessionId,
    session,
    agentGraphFile: args.agentGraphFile,
    persistSession: async (targetSession) => persistOrchestrationSession(args.sessionStore, targetSession),
    removeLiveSessionCache: (targetSessionId) => {
      args.liveSessionCache.delete(targetSessionId);
    },
    clearQueue: (targetSessionId) => args.orchestrationQueueStore.clear(targetSessionId),
    saveSessionHistory: args.saveSessionHistory,
    onSessionCompleted: args.onSessionCompleted,
    emitSystemEvent: args.emitSystemEvent
  });

  return {
    response: buildDequeueNextAgentResponse({
      sessionId: args.sessionId,
      dequeued: nextAgents,
      remainingQueue: session.queue,
      graphRecommendation,
      snapshotVersion,
      totalAgents: session.agents.length
    }) as Record<string, unknown>
  };
}
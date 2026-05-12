import type { OrchestrationSession } from "../../../types/index.js";
import type { TriggerRule } from "../../../types/index.js";

export async function resolveEvaluateTriggersContext(args: {
  sessionId?: string;
  triggerRules?: TriggerRule[];
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
  buildSessionNotFoundText: (sessionId: string) => string;
}): Promise<{
  session?: OrchestrationSession;
  rules: TriggerRule[];
  firedRules: string[];
  notFoundText?: string;
}> {
  const rules = args.triggerRules ?? [];
  if (!args.sessionId) {
    return {
      session: undefined,
      rules,
      firedRules: []
    };
  }

  const session = await args.getSessionOrRestore(args.sessionId);
  if (!session) {
    return {
      session: undefined,
      rules,
      firedRules: [],
      notFoundText: args.buildSessionNotFoundText(args.sessionId)
    };
  }

  return {
    session,
    rules: rules.length > 0 ? rules : session.triggerRules,
    firedRules: session.firedRules
  };
}

export async function applyTriggerTurnToSession(args: {
  session: OrchestrationSession;
  lastAgent: string;
  lastMessage: string;
  firedRules: string[];
  nextAgents: string[];
  reasons: string[];
  replaceQueue: (sessionId: string, queue: string[]) => Promise<void>;
  enqueueStep: (input: {
    sessionId: string;
    stepIndex: number;
    agent: string;
    payload: { triggeredBy: string; reason: string | null };
    checkpoint: { queueLength: number; firedRules: number };
  }) => Promise<unknown>;
  upsertSession: (session: OrchestrationSession) => Promise<unknown>;
}): Promise<void> {
  args.session.history.push({
    agent: args.lastAgent,
    message: args.lastMessage,
    timestamp: new Date().toISOString(),
    topic: args.session.topic
  });
  args.session.firedRules.push(...args.firedRules);
  for (const nextAgent of args.nextAgents) {
    args.session.queue.push(nextAgent);
  }

  await args.replaceQueue(args.session.id, args.session.queue);

  const currentMaxStep = args.session.history.length + args.session.queue.length - args.nextAgents.length;
  for (const [offset, nextAgent] of args.nextAgents.entries()) {
    await args.enqueueStep({
      sessionId: args.session.id,
      stepIndex: currentMaxStep + offset,
      agent: nextAgent,
      payload: {
        triggeredBy: args.lastAgent,
        reason: args.reasons[offset] ?? null
      },
      checkpoint: {
        queueLength: args.session.queue.length,
        firedRules: args.session.firedRules.length
      }
    });
  }

  await args.upsertSession(args.session);
}

export function buildEvaluateTriggersResponse(args: {
  sessionId?: string;
  nextAgents: string[];
  reasons: string[];
  usedRoundRobinFallback: boolean;
  queueLength: number | null;
  trustScoring: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    sessionId: args.sessionId ?? null,
    nextAgents: args.nextAgents,
    reasons: args.reasons,
    usedRoundRobinFallback: args.usedRoundRobinFallback,
    queueLength: args.queueLength,
    trustScoring: args.trustScoring
  };
}

export function buildTurnCompleteEventPayload(args: {
  lastAgent: string;
  response: ReturnType<typeof buildEvaluateTriggersResponse>;
}): Record<string, unknown> {
  return {
    sessionId: args.response.sessionId,
    lastAgent: args.lastAgent,
    nextAgents: args.response.nextAgents,
    reasons: args.response.reasons,
    usedRoundRobinFallback: args.response.usedRoundRobinFallback,
    queueLength: args.response.queueLength,
    trustScoring: args.response.trustScoring
  };
}
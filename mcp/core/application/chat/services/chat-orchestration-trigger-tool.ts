import type { TriggerRule, OrchestrationSession } from "../../../types/index.js";
import type { AgentTrustEvaluation } from "../../../quality/agent-trust-score.js";
import {
  applyRoundRobinFallback,
  buildTrustScoringPayload,
  evaluateTriggerTrustWithTrace
} from "./chat-trigger-evaluation.js";
import {
  applyTriggerTurnToSession,
  buildEvaluateTriggersResponse,
  buildTurnCompleteEventPayload,
  resolveEvaluateTriggersContext
} from "./chat-trigger-session-update.js";

export async function executeEvaluateTriggersTool(args: {
  sessionId?: string;
  lastAgent: string;
  lastMessage: string;
  triggerRules?: TriggerRule[];
  fallbackRoundRobin?: boolean;
  enableTrustScoring?: boolean;
  trustThreshold: number;
  agentFeedback?: "accept" | "reject" | "neutral";
  maxEscalations?: number;
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
  buildSessionNotFoundText: (sessionId: string) => string;
  replaceQueue: (sessionId: string, queue: string[]) => Promise<void>;
  enqueueStep: (input: {
    sessionId: string;
    stepIndex: number;
    agent: string;
    payload: { triggeredBy: string; reason: string | null };
    checkpoint: { queueLength: number; firedRules: number };
  }) => Promise<unknown>;
  upsertSession: (session: OrchestrationSession) => Promise<unknown>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  startTrace: (name: string, attrs?: Record<string, unknown>) => string;
  endTrace: (traceId: string, attrs?: Record<string, unknown>) => void;
  failTrace: (traceId: string, err: unknown, attrs?: Record<string, unknown>) => void;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  let session: OrchestrationSession | undefined;
  let roundRobinNext: string | null = null;

  const context = await resolveEvaluateTriggersContext({
    sessionId: args.sessionId,
    triggerRules: args.triggerRules,
    getSessionOrRestore: args.getSessionOrRestore,
    buildSessionNotFoundText: args.buildSessionNotFoundText
  });
  if (context.notFoundText) {
    return { notFoundText: context.notFoundText };
  }
  session = context.session;

  const hookResult = args.evaluatePseudoHooks(args.lastAgent, args.lastMessage, context.rules, context.firedRules);
  let nextAgents = [...hookResult.nextAgents];
  let escalatedAgents: string[] = [];
  const trustScoringEnabled = args.enableTrustScoring ?? true;
  let trustEvaluation: AgentTrustEvaluation | null = null;

  const fallback = applyRoundRobinFallback({
    session,
    lastAgent: args.lastAgent,
    nextAgents,
    fallbackRoundRobin: args.fallbackRoundRobin ?? true
  });
  nextAgents = fallback.nextAgents;
  roundRobinNext = fallback.roundRobinNext;

  if (session) {
    const trustResult = evaluateTriggerTrustWithTrace({
      session,
      lastAgent: args.lastAgent,
      lastMessage: args.lastMessage,
      nextAgents,
      trustScoringEnabled,
      trustThreshold: args.trustThreshold,
      agentFeedback: args.agentFeedback,
      maxEscalations: args.maxEscalations,
      startTrace: args.startTrace,
      endTrace: args.endTrace,
      failTrace: args.failTrace
    });
    if (trustResult) {
      nextAgents = trustResult.nextAgents;
      escalatedAgents = trustResult.escalatedAgents;
      trustEvaluation = trustResult.trustEvaluation;
      session.agentTrust[args.lastAgent] = trustResult.currentTrust;
    }
  }

  const trustScoringPayload = buildTrustScoringPayload({
    trustEvaluation,
    trustScoringEnabled,
    escalatedAgents
  });

  if (session) {
    await applyTriggerTurnToSession({
      session,
      lastAgent: args.lastAgent,
      lastMessage: args.lastMessage,
      firedRules: hookResult.fired,
      nextAgents,
      reasons: hookResult.reasons,
      replaceQueue: args.replaceQueue,
      enqueueStep: args.enqueueStep,
      upsertSession: args.upsertSession
    });
  }

  const triggerResponse = buildEvaluateTriggersResponse({
    sessionId: args.sessionId,
    nextAgents,
    reasons: hookResult.reasons,
    usedRoundRobinFallback: roundRobinNext !== null,
    queueLength: session ? session.queue.length : null,
    trustScoring: trustScoringPayload
  });

  await args.emitSystemEvent(
    "turn_complete",
    buildTurnCompleteEventPayload({
      lastAgent: args.lastAgent,
      response: triggerResponse
    })
  );

  return { response: triggerResponse as Record<string, unknown> };
}
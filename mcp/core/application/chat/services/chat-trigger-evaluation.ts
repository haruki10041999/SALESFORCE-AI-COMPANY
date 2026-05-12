import type { OrchestrationSession } from "../../../types/index.js";
import {
  evaluateAgentTrust,
  rankEscalationCandidates,
  type AgentTrustEvaluation
} from "../../../quality/agent-trust-score.js";

export type TriggerAgentFeedback = "accept" | "reject" | "neutral";

export interface TriggerTrustState {
  accepted: number;
  rejected: number;
  feedbackSignal: number;
}

export function applyRoundRobinFallback(args: {
  session?: OrchestrationSession;
  lastAgent: string;
  nextAgents: string[];
  fallbackRoundRobin: boolean;
}): { nextAgents: string[]; roundRobinNext: string | null } {
  if (!args.session || !args.fallbackRoundRobin || args.nextAgents.length > 0 || args.session.agents.length === 0) {
    return {
      nextAgents: args.nextAgents,
      roundRobinNext: null
    };
  }

  const idx = args.session.agents.indexOf(args.lastAgent);
  const nextIndex = idx >= 0 ? (idx + 1) % args.session.agents.length : 0;
  const roundRobinNext = args.session.agents[nextIndex];
  return {
    nextAgents: [roundRobinNext],
    roundRobinNext
  };
}

export function evaluateTriggerTrust(args: {
  session: OrchestrationSession;
  lastAgent: string;
  lastMessage: string;
  nextAgents: string[];
  trustScoringEnabled: boolean;
  trustThreshold: number;
  agentFeedback?: TriggerAgentFeedback;
  maxEscalations?: number;
}): {
  nextAgents: string[];
  escalatedAgents: string[];
  trustEvaluation: AgentTrustEvaluation | null;
  currentTrust: TriggerTrustState;
} {
  const currentTrust: TriggerTrustState = args.session.agentTrust[args.lastAgent] ?? {
    accepted: 0,
    rejected: 0,
    feedbackSignal: 0
  };

  if (args.agentFeedback === "accept") {
    currentTrust.accepted += 1;
    currentTrust.feedbackSignal = Math.min(1, currentTrust.feedbackSignal + 0.25);
  } else if (args.agentFeedback === "reject") {
    currentTrust.rejected += 1;
    currentTrust.feedbackSignal = Math.max(-1, currentTrust.feedbackSignal - 0.25);
  } else if (args.nextAgents.length > 0) {
    currentTrust.accepted += 1;
  } else {
    currentTrust.rejected += 1;
  }

  if (!args.trustScoringEnabled) {
    return {
      nextAgents: args.nextAgents,
      escalatedAgents: [],
      trustEvaluation: null,
      currentTrust
    };
  }

  const trustEvaluation = evaluateAgentTrust({
    topic: args.session.topic,
    message: args.lastMessage,
    history: {
      accepted: currentTrust.accepted,
      rejected: currentTrust.rejected
    },
    feedbackSignal: currentTrust.feedbackSignal,
    threshold: args.trustThreshold
  });

  let nextAgents = [...args.nextAgents];
  let escalatedAgents: string[] = [];
  if (trustEvaluation.belowThreshold && args.session.agents.length > 1) {
    const ranked = rankEscalationCandidates(
      args.session.agents,
      args.session.topic,
      args.lastMessage,
      [args.lastAgent, ...nextAgents]
    );
    const escalations = ranked.slice(0, args.maxEscalations ?? 1);
    if (escalations.length > 0) {
      escalatedAgents = escalations;
      nextAgents = [...nextAgents, ...escalations];
    }
  }

  return {
    nextAgents,
    escalatedAgents,
    trustEvaluation,
    currentTrust
  };
}

export function evaluateTriggerTrustWithTrace(args: {
  session: OrchestrationSession;
  lastAgent: string;
  lastMessage: string;
  nextAgents: string[];
  trustScoringEnabled: boolean;
  trustThreshold: number;
  agentFeedback?: TriggerAgentFeedback;
  maxEscalations?: number;
  startTrace: (name: string, metadata: Record<string, unknown>) => string;
  endTrace: (traceId: string, metadata: Record<string, unknown>) => void;
  failTrace: (traceId: string, error: unknown) => void;
}): ReturnType<typeof evaluateTriggerTrust> | null {
  if (!args.trustScoringEnabled) {
    return evaluateTriggerTrust({
      session: args.session,
      lastAgent: args.lastAgent,
      lastMessage: args.lastMessage,
      nextAgents: args.nextAgents,
      trustScoringEnabled: false,
      trustThreshold: args.trustThreshold,
      agentFeedback: args.agentFeedback,
      maxEscalations: args.maxEscalations
    });
  }

  const trustTraceId = args.startTrace("agent_trust_evaluation", {
    sessionId: args.session.id,
    lastAgent: args.lastAgent
  });
  try {
    const trustResult = evaluateTriggerTrust({
      session: args.session,
      lastAgent: args.lastAgent,
      lastMessage: args.lastMessage,
      nextAgents: args.nextAgents,
      trustScoringEnabled: true,
      trustThreshold: args.trustThreshold,
      agentFeedback: args.agentFeedback,
      maxEscalations: args.maxEscalations
    });

    args.endTrace(trustTraceId, {
      sessionId: args.session.id,
      lastAgent: args.lastAgent,
      trustScore: trustResult.trustEvaluation?.score ?? null,
      trustThreshold: trustResult.trustEvaluation?.threshold ?? args.trustThreshold,
      belowThreshold: trustResult.trustEvaluation?.belowThreshold ?? false,
      factors: trustResult.trustEvaluation?.factors ?? null,
      escalatedAgents: trustResult.escalatedAgents
    });
    return trustResult;
  } catch (error) {
    args.failTrace(trustTraceId, error);
    return null;
  }
}

export function buildTrustScoringPayload(args: {
  trustEvaluation: AgentTrustEvaluation | null;
  trustScoringEnabled: boolean;
  escalatedAgents: string[];
}): Record<string, unknown> {
  if (args.trustEvaluation) {
    return {
      enabled: true,
      score: args.trustEvaluation.score,
      threshold: args.trustEvaluation.threshold,
      belowThreshold: args.trustEvaluation.belowThreshold,
      reasons: args.trustEvaluation.reasons,
      escalatedAgents: args.escalatedAgents
    };
  }
  return {
    enabled: args.trustScoringEnabled,
    escalatedAgents: args.escalatedAgents
  };
}
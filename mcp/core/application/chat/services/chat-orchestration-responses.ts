import type { OrchestrationSession } from "../../../types/index.js";

export function buildGetOrchestrationSessionResponse(session: OrchestrationSession): Record<string, unknown> {
  return {
    id: session.id,
    topic: session.topic,
    agents: session.agents,
    queue: session.queue,
    triggerRules: session.triggerRules,
    historyCount: session.history.length,
    firedRuleCount: session.firedRules.length
  };
}

export function buildSaveOrchestrationSessionResponse(args: {
  sessionId: string;
  filePath: string;
  historyCount: number;
}): Record<string, unknown> {
  return {
    saved: true,
    sessionId: args.sessionId,
    filePath: args.filePath,
    historyCount: args.historyCount
  };
}

export function buildRestoreOrchestrationSessionResponse(session: OrchestrationSession): Record<string, unknown> {
  return {
    restored: true,
    id: session.id,
    topic: session.topic,
    queueLength: session.queue.length,
    historyCount: session.history.length,
    firedRuleCount: session.firedRules.length
  };
}

export function buildSessionNotFoundText(sessionId: string): string {
  return `Session not found: ${sessionId}`;
}

export function buildSavedSessionNotFoundText(sessionId: string): string {
  return `Saved session not found: ${sessionId}`;
}
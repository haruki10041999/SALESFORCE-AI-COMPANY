import type { SystemEventRecord } from "../../../event/system-event-manager.js";

export interface ToolExecutionAggregate {
  totals: {
    total: number;
    success: number;
    failure: number;
    blockedByDisable: number;
  };
  rates: {
    successRate: number;
    failureRate: number;
  };
  perTool: Record<string, { total: number; success: number; failure: number; blocked: number }>;
}

export function aggregateToolAfterExecuteEvents(events: SystemEventRecord[]): ToolExecutionAggregate {
  const perTool: Record<string, { total: number; success: number; failure: number; blocked: number }> = {};
  let total = 0;
  let success = 0;
  let failure = 0;
  let blocked = 0;

  for (const event of events) {
    const payload = (event.payload ?? {}) as {
      toolName?: string;
      success?: boolean;
      blockedByDisable?: boolean;
    };
    const toolName = payload.toolName ?? "unknown";
    const toolStats = perTool[toolName] ?? { total: 0, success: 0, failure: 0, blocked: 0 };

    total += 1;
    toolStats.total += 1;

    if (payload.success === true) {
      success += 1;
      toolStats.success += 1;
    } else {
      failure += 1;
      toolStats.failure += 1;
    }

    if (payload.blockedByDisable === true) {
      blocked += 1;
      toolStats.blocked += 1;
    }

    perTool[toolName] = toolStats;
  }

  return {
    totals: {
      total,
      success,
      failure,
      blockedByDisable: blocked
    },
    rates: {
      successRate: total === 0 ? 0 : Number(((success / total) * 100).toFixed(2)),
      failureRate: total === 0 ? 0 : Number(((failure / total) * 100).toFixed(2))
    },
    perTool
  };
}

export interface TriggerRuleRecommendation {
  whenAgent: string;
  thenAgent: string;
  confidence: number;
  support: number;
  reason: string;
  once: boolean;
}

export function generateTriggerRuleRecommendations(
  events: SystemEventRecord[],
  minSupport: number,
  minConfidence: number
): TriggerRuleRecommendation[] {
  const transitionCounts = new Map<string, number>();
  const fromCounts = new Map<string, number>();

  for (const event of events) {
    const payload = event.payload ?? {};
    const lastAgent = typeof payload.lastAgent === "string" ? payload.lastAgent : null;
    const nextAgents = Array.isArray(payload.nextAgents) ? payload.nextAgents.filter((v) => typeof v === "string") as string[] : [];
    if (!lastAgent || nextAgents.length === 0) continue;

    fromCounts.set(lastAgent, (fromCounts.get(lastAgent) ?? 0) + nextAgents.length);
    for (const nextAgent of nextAgents) {
      const key = `${lastAgent}=>${nextAgent}`;
      transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
    }
  }

  const recommendations: TriggerRuleRecommendation[] = [];
  for (const [key, support] of transitionCounts.entries()) {
    if (support < minSupport) continue;
    const [whenAgent, thenAgent] = key.split("=>");
    const totalFrom = fromCounts.get(whenAgent) ?? 1;
    const confidence = support / totalFrom;
    if (confidence < minConfidence) continue;
    recommendations.push({
      whenAgent,
      thenAgent,
      confidence: Number(confidence.toFixed(4)),
      support,
      reason: `auto-tuned from ${support} turn_complete transitions`,
      once: false
    });
  }

  return recommendations.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
}

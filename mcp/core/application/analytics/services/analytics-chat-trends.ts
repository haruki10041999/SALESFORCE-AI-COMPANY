import type { AgentMessage } from "../../../types/index.js";
import type { ChatSession } from "../../../types/index.js";

export type ChatTrendGroupBy = "agent" | "topic";

export interface ChatTrendGroupStats {
  count: number;
  avgLength: number;
  topics?: string[];
  agents?: string[];
}

export function resolveChatTrendEntries(args: {
  agentLog: AgentMessage[];
  sessions: ChatSession[];
  historyId?: string;
}): { entries: AgentMessage[]; errorText?: string } {
  if (!args.historyId) {
    return { entries: args.agentLog };
  }

  const session = args.sessions.find((entry) => entry.id === args.historyId);
  if (!session) {
    return {
      entries: [],
      errorText: `History not found: ${args.historyId}`
    };
  }
  return { entries: session.entries };
}

export function filterChatTrendEntriesSince(entries: AgentMessage[], since?: string): AgentMessage[] {
  if (!since) {
    return entries;
  }
  const cutoff = new Date(since);
  return entries.filter((entry) => new Date(entry.timestamp) >= cutoff);
}

export function buildChatTrendStats(entries: AgentMessage[], groupBy: ChatTrendGroupBy): {
  totalMessages: number;
  uniqueGroups: number;
  groupBy: ChatTrendGroupBy;
  stats: Record<string, ChatTrendGroupStats>;
} {
  const stats: Record<string, ChatTrendGroupStats> = {};

  for (const entry of entries) {
    const groupName = groupBy === "topic" ? (entry.topic ?? "unknown") : entry.agent;
    if (!stats[groupName]) {
      stats[groupName] = { count: 0, avgLength: 0, ...(groupBy === "agent" ? { topics: [] } : { agents: [] }) };
    }
    stats[groupName].count += 1;
    const previousAverage = stats[groupName].avgLength;
    stats[groupName].avgLength = previousAverage + (entry.message.length - previousAverage) / stats[groupName].count;
    if (groupBy === "agent" && entry.topic && !stats[groupName].topics!.includes(entry.topic)) {
      stats[groupName].topics!.push(entry.topic);
    }
    if (groupBy === "topic" && !stats[groupName].agents!.includes(entry.agent)) {
      stats[groupName].agents!.push(entry.agent);
    }
  }

  return {
    totalMessages: entries.length,
    uniqueGroups: Object.keys(stats).length,
    groupBy,
    stats
  };
}

export function buildAnalyzeChatTrendsResponse(args: {
  totalMessages: number;
  uniqueGroups: number;
  groupBy: ChatTrendGroupBy;
  historyId?: string;
  since?: string;
  stats: Record<string, ChatTrendGroupStats>;
}): Record<string, unknown> {
  return {
    totalMessages: args.totalMessages,
    uniqueGroups: args.uniqueGroups,
    groupBy: args.groupBy,
    historyId: args.historyId ?? "current",
    since: args.since ?? null,
    stats: args.stats
  };
}
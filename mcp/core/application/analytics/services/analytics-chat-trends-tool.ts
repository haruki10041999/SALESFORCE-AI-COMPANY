import type { AgentMessage, ChatSession } from "../../../types/index.js";

export async function executeAnalyzeChatTrendsTool(args: {
  historyId?: string;
  since?: string;
  groupBy?: "agent" | "topic";
  agentLog: AgentMessage[];
  loadChatHistories: () => Promise<ChatSession[]>;
}): Promise<Record<string, unknown>> {
  const { historyId, since, groupBy, agentLog, loadChatHistories } = args;

  let targetEntries: AgentMessage[] = agentLog;

  if (historyId) {
    const session = await loadChatHistories().then((sessions) => sessions.find((entry) => entry.id === historyId));
    if (!session) {
      return { errorText: `History not found: ${historyId}` };
    }
    targetEntries = session.entries;
  }

  if (since) {
    const cutoff = new Date(since);
    targetEntries = targetEntries.filter((entry) => new Date(entry.timestamp) >= cutoff);
  }

  const key = groupBy ?? "agent";
  const stats: Record<string, { count: number; avgLength: number; topics?: string[]; agents?: string[] }> = {};

  for (const entry of targetEntries) {
    const groupName = key === "topic" ? (entry.topic ?? "unknown") : entry.agent;
    if (!stats[groupName]) {
      stats[groupName] = { count: 0, avgLength: 0, ...(key === "agent" ? { topics: [] } : { agents: [] }) };
    }
    stats[groupName].count++;
    const previousAverage = stats[groupName].avgLength;
    stats[groupName].avgLength = previousAverage + (entry.message.length - previousAverage) / stats[groupName].count;
    if (key === "agent" && entry.topic && !stats[groupName].topics!.includes(entry.topic)) {
      stats[groupName].topics!.push(entry.topic);
    }
    if (key === "topic" && !stats[groupName].agents!.includes(entry.agent)) {
      stats[groupName].agents!.push(entry.agent);
    }
  }

  return {
    totalMessages: targetEntries.length,
    uniqueGroups: Object.keys(stats).length,
    groupBy: key,
    historyId: historyId ?? "current",
    since: since ?? null,
    stats
  };
}

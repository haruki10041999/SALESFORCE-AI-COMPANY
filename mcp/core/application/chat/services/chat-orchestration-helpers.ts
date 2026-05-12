import type { OrchestrationSession } from "../../../types/index.js";
import type { SessionStore } from "../../../persistence/session-store.js";
import type { PolicySnapshotManager } from "../../../learning/policy-snapshot.js";
import {
  loadAgentReputationRecords,
  computeAgentReputationScore
} from "../../../learning/agent-reputation.js";
import { scoreByQuery } from "../../../resource/topic-skill-ranking.js";

export async function executePersistSession(
  session: OrchestrationSession,
  sessionStore: SessionStore
): Promise<{ sessionId: string; filePath: string; historyCount: number }> {
  await sessionStore.upsert(session, -1);
  return {
    sessionId: session.id,
    filePath: `store://orchestration_sessions/${session.id}`,
    historyCount: Array.isArray(session.history) ? session.history.length : 0
  };
}

export async function executePrioritizeQueueByPolicy(args: {
  queue: string[];
  topic: string;
  policySnapshotManager?: PolicySnapshotManager;
  agentReputationFile: string;
}): Promise<{ ordered: string[]; snapshotVersion: number | null }> {
  const { queue, topic, policySnapshotManager, agentReputationFile } = args;

  if (queue.length <= 1) {
    return { ordered: queue, snapshotVersion: policySnapshotManager?.current?.version ?? null };
  }

  // ── T-07: live mode → use online posterior from PolicySnapshotManager ──
  if (policySnapshotManager?.isLive && policySnapshotManager.current) {
    const repScores = policySnapshotManager.reputationScores(queue, topic);
    const topicScores = new Map<string, number>(queue.map(a => [a, scoreByQuery(topic, a)]));
    const maxTopicScore = Math.max(0, ...Array.from(topicScores.values()));
    const ordered = [...queue].sort((a, b) => {
      const repDiff = (repScores.get(b) ?? 0.5) - (repScores.get(a) ?? 0.5);
      if (Math.abs(repDiff) > 1e-9) { return repDiff; }
      const topicNorm = maxTopicScore > 0 ? 1 / maxTopicScore : 1;
      const topicDiff = (topicScores.get(b) ?? 0) * topicNorm - (topicScores.get(a) ?? 0) * topicNorm;
      if (topicDiff !== 0) { return topicDiff; }
      return a.localeCompare(b);
    });
    return { ordered, snapshotVersion: policySnapshotManager.current.version };
  }

  // ── shadow / no snapshot: legacy reputation + topic scoring ──
  const reputationRecords = await loadAgentReputationRecords(agentReputationFile);
  const topicScores = new Map<string, number>();
  for (const agent of queue) {
    topicScores.set(agent, scoreByQuery(topic, agent));
  }
  const maxTopicScore = Math.max(0, ...Array.from(topicScores.values()));

  const priority = (agent: string): number => {
    const reputation = computeAgentReputationScore(reputationRecords, agent, "global", "global", 0.5);
    const topicRelevance = maxTopicScore > 0
      ? (topicScores.get(agent) ?? 0) / maxTopicScore
      : 1;
    return reputation * topicRelevance;
  };

  const ordered = [...queue].sort((a, b) => {
    const pDiff = priority(b) - priority(a);
    if (Math.abs(pDiff) > 1e-9) {
      return pDiff;
    }
    const topicDiff = (topicScores.get(b) ?? 0) - (topicScores.get(a) ?? 0);
    if (topicDiff !== 0) {
      return topicDiff;
    }
    // deterministic fallback when both priority and topic relevance are tied
    return a.localeCompare(b);
  });
  return { ordered, snapshotVersion: null };
}

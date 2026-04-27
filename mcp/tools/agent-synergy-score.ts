/**
 * A6: \u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u5354\u8abf\u30b9\u30b3\u30a2 (Agent Synergy Score)
 *
 * \u30c1\u30e3\u30c3\u30c8\u5c65\u6b74 (ChatSession[]) \u304b\u3089\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u30da\u30a2\u306e
 * \u5171\u8d77\u983b\u5ea6\u3068 lift (= P(A,B) / (P(A) * P(B))) \u3092\u7b97\u51fa\u3057\u3001\u5354\u8abf\u30b9\u30b3\u30a2\u3092
 * \u8fd4\u3059\u7d14\u7c8b\u95a2\u6570\u3002
 *
 * Score = lift * log(1 + cooccurrence) * (avgEntries / maxEntries)
 *  - lift: \u4e0a\u8a18\u306e\u72ec\u7acb\u4eee\u5b9a\u30b9\u30b3\u30a2\u3002\u5024 > 1 \u306f\u30dd\u30b8\u30c6\u30a3\u30d6\u306a\u5354\u8abf\u3002
 *  - log(1 + cooccurrence): \u6e9c\u3081\u308b\u51fa\u73fe\u56de\u6570\u30dc\u30fc\u30ca\u30b9\u3002
 *  - avgEntries \u6b63\u898f\u5316: \u767a\u8a00\u306e\u8c4a\u304b\u3055\u3092\u8003\u616e\u3002
 */

export interface AgentSynergyChatSession {
  id?: string;
  agents: string[];
  entries: Array<{ agent: string }>;
}

export interface AgentSynergyOptions {
  /** \u30b9\u30b3\u30a2\u4e0a\u4f4d\u4ef6\u6570 */
  limit?: number;
  /** \u3053\u308c\u4ee5\u4e0a\u306e\u5171\u8d77\u983b\u5ea6\u304c\u3042\u308b\u30da\u30a2\u306e\u307f\u8fd4\u3059 */
  minCooccurrence?: number;
}

export interface AgentSynergyPair {
  pair: [string, string];
  cooccurrence: number;
  occurrencesA: number;
  occurrencesB: number;
  lift: number;
  avgEntriesA: number;
  avgEntriesB: number;
  score: number;
}

export interface AgentSynergyResult {
  totalSessions: number;
  totalAgents: number;
  pairs: AgentSynergyPair[];
}

/** \u91cd\u8907\u3092\u53d6\u308a\u9664\u304d\u3001\u30bd\u30fc\u30c8\u3057\u305f\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u96c6\u5408 */
function uniqueSortedAgents(agents: string[]): string[] {
  const set = new Set<string>();
  for (const a of agents) {
    if (typeof a === "string" && a.length > 0) {
      set.add(a);
    }
  }
  return Array.from(set).sort();
}

function pairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

export function scoreAgentSynergy(
  sessions: AgentSynergyChatSession[],
  options: AgentSynergyOptions = {}
): AgentSynergyResult {
  const { limit = 20, minCooccurrence = 1 } = options;

  const agentSessionCount = new Map<string, number>();
  const agentEntryTotals = new Map<string, { total: number; sessions: number }>();
  const pairCount = new Map<string, number>();

  for (const session of sessions) {
    const agents = uniqueSortedAgents(session.agents ?? []);
    if (agents.length === 0) continue;

    for (const agent of agents) {
      agentSessionCount.set(agent, (agentSessionCount.get(agent) ?? 0) + 1);
    }

    const entryCounts = new Map<string, number>();
    for (const entry of session.entries ?? []) {
      if (!entry?.agent) continue;
      entryCounts.set(entry.agent, (entryCounts.get(entry.agent) ?? 0) + 1);
    }
    for (const [agent, count] of entryCounts.entries()) {
      const prev = agentEntryTotals.get(agent) ?? { total: 0, sessions: 0 };
      agentEntryTotals.set(agent, { total: prev.total + count, sessions: prev.sessions + 1 });
    }

    for (let i = 0; i < agents.length; i += 1) {
      for (let j = i + 1; j < agents.length; j += 1) {
        const key = pairKey(agents[i], agents[j]);
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const totalSessions = sessions.length;
  const pairs: AgentSynergyPair[] = [];

  for (const [key, cooccurrence] of pairCount.entries()) {
    if (cooccurrence < minCooccurrence) continue;
    const [a, b] = key.split("\u0000");
    const occA = agentSessionCount.get(a) ?? 0;
    const occB = agentSessionCount.get(b) ?? 0;

    // P(A,B) / (P(A) * P(B)) \u3092 totalSessions \u3067\u5c55\u958b
    // = (cooccurrence * totalSessions) / (occA * occB)
    const lift = occA > 0 && occB > 0
      ? (cooccurrence * totalSessions) / (occA * occB)
      : 0;

    const avgA = (() => {
      const e = agentEntryTotals.get(a);
      return e && e.sessions > 0 ? e.total / e.sessions : 0;
    })();
    const avgB = (() => {
      const e = agentEntryTotals.get(b);
      return e && e.sessions > 0 ? e.total / e.sessions : 0;
    })();

    const verbosityFactor = (avgA + avgB) > 0
      ? Math.min(1, (avgA + avgB) / 10)
      : 0.1;

    const score = lift * Math.log(1 + cooccurrence) * (0.5 + 0.5 * verbosityFactor);

    pairs.push({
      pair: [a, b],
      cooccurrence,
      occurrencesA: occA,
      occurrencesB: occB,
      lift: Number(lift.toFixed(4)),
      avgEntriesA: Number(avgA.toFixed(2)),
      avgEntriesB: Number(avgB.toFixed(2)),
      score: Number(score.toFixed(4))
    });
  }

  pairs.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (y.cooccurrence !== x.cooccurrence) return y.cooccurrence - x.cooccurrence;
    return x.pair[0].localeCompare(y.pair[0]);
  });

  return {
    totalSessions,
    totalAgents: agentSessionCount.size,
    pairs: pairs.slice(0, limit)
  };
}

export const __testables = { uniqueSortedAgents };

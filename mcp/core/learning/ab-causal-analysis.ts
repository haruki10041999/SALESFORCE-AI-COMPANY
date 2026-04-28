export type AgentAbHistoryRun = {
  winner?: { overall?: string };
  comparison?: string;
  runs?: {
    agentA?: { agent?: string; qualityScore?: number; durationMs?: number };
    agentB?: { agent?: string; qualityScore?: number; durationMs?: number };
  };
  generatedAt?: string;
};

export type AbComparisonCausalStats = {
  comparison: string;
  runs: number;
  decisiveRuns: number;
  wins: Record<string, number>;
  winRate: Record<string, number>;
  pValueTwoSided: number | null;
  significantAt05: boolean;
  confidence95: Record<string, { low: number; high: number }>;
};

function round(v: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

function parseMonth(value?: string): string {
  if (!value) return "unknown";
  const m = String(value).match(/^(\d{4}-\d{2})/);
  return m ? m[1] : "unknown";
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

function wilson95(successes: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: round(Math.max(0, center - margin), 4),
    high: round(Math.min(1, center + margin), 4)
  };
}

export function summarizeAbCausalHistory(runs: AgentAbHistoryRun[]) {
  const perAgent = new Map<string, { runs: number; wins: number; totalQuality: number; totalLatency: number }>();
  const byComparison = new Map<string, { runs: number; a: string; b: string; winsA: number; winsB: number; undecided: number }>();
  const byMonth = new Map<string, number>();

  for (const run of runs) {
    const a = run.runs?.agentA;
    const b = run.runs?.agentB;
    const winner = run.winner?.overall;
    if (!a?.agent || !b?.agent) continue;
    const aAgent = a.agent;
    const bAgent = b.agent;

    const month = parseMonth(run.generatedAt);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);

    const pairKey = run.comparison ?? `${aAgent} vs ${bAgent}`;
    const pairStats = byComparison.get(pairKey) ?? {
      runs: 0,
      a: aAgent,
      b: bAgent,
      winsA: 0,
      winsB: 0,
      undecided: 0
    };
    pairStats.runs += 1;
    if (winner === aAgent) pairStats.winsA += 1;
    else if (winner === bAgent) pairStats.winsB += 1;
    else pairStats.undecided += 1;
    byComparison.set(pairKey, pairStats);

    const participants: Array<{ agent: string; qualityScore?: number; durationMs?: number }> = [
      { agent: aAgent, qualityScore: a.qualityScore, durationMs: a.durationMs },
      { agent: bAgent, qualityScore: b.qualityScore, durationMs: b.durationMs }
    ];

    for (const side of participants) {
      const stats = perAgent.get(side.agent) ?? { runs: 0, wins: 0, totalQuality: 0, totalLatency: 0 };
      stats.runs += 1;
      stats.totalQuality += side.qualityScore ?? 0;
      stats.totalLatency += side.durationMs ?? 0;
      if (winner === side.agent) stats.wins += 1;
      perAgent.set(side.agent, stats);
    }
  }

  const agentRanking = [...perAgent.entries()]
    .map(([agent, s]) => ({
      agent,
      runs: s.runs,
      wins: s.wins,
      winRate: s.runs > 0 ? round(s.wins / s.runs, 4) : 0,
      avgQuality: s.runs > 0 ? round(s.totalQuality / s.runs, 2) : 0,
      avgLatencyMs: s.runs > 0 ? round(s.totalLatency / s.runs, 2) : 0
    }))
    .sort((x, y) => y.winRate - x.winRate || y.avgQuality - x.avgQuality);

  const comparisons: AbComparisonCausalStats[] = [...byComparison.entries()]
    .map(([comparison, s]) => {
      const decisive = s.winsA + s.winsB;
      const pA = decisive > 0 ? s.winsA / decisive : 0;
      const z = decisive > 0 ? (s.winsA - decisive / 2) / Math.sqrt(decisive * 0.25) : 0;
      const pValue = decisive > 0 ? Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))) : null;
      return {
        comparison,
        runs: s.runs,
        decisiveRuns: decisive,
        wins: {
          [s.a]: s.winsA,
          [s.b]: s.winsB,
          undecided: s.undecided
        },
        winRate: {
          [s.a]: round(pA, 4),
          [s.b]: round(1 - pA, 4)
        },
        pValueTwoSided: pValue === null ? null : round(pValue, 6),
        significantAt05: pValue !== null && pValue < 0.05,
        confidence95: {
          [s.a]: wilson95(s.winsA, Math.max(1, decisive)),
          [s.b]: wilson95(s.winsB, Math.max(1, decisive))
        }
      };
    })
    .sort((x, y) => y.runs - x.runs);

  const monthlyStrata = [...byMonth.entries()]
    .map(([month, count]) => ({ month, runs: count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalRuns: runs.length,
    agentRanking,
    comparisons,
    monthlyStrata
  };
}

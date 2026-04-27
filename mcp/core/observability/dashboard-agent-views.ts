/**
 * T-ADD-09: agent × topic ヒートマップ & 信頼スコア時系列。
 *
 * dashboard.ts と同等のパターンで、副作用なしの純粋関数として提供する。
 * 入力は既存の `ObservabilityTrace` 互換形式 (toolName を agent 名と読み替え可能) と、
 * `agent-trust-score` 由来のタイムスタンプ付きスコアシリーズ。
 *
 * 出力には Markdown / HTML レンダリング文字列を含み、観察側はそのまま埋め込みできる。
 */

export interface AgentTopicSample {
  agent: string;
  topic: string;
  /** その agent×topic で観測した件数 (success+error 合算) */
  count: number;
  /** 成功率 0..1 */
  successRate: number;
}

export interface AgentTrustScoreSample {
  agent: string;
  timestamp: string;
  trustScore: number;
}

export interface DashboardHeatmapResult {
  agents: string[];
  topics: string[];
  /** rows[agentIdx][topicIdx] = success rate (0..1)。観測なしは null */
  matrix: Array<Array<number | null>>;
  markdown: string;
}

export interface DashboardTrustTimelineResult {
  agents: string[];
  buckets: string[];
  /** series[agentIdx] = [bucketごとの平均 trust score, null=データなし] */
  series: Array<Array<number | null>>;
  markdown: string;
}

export function buildAgentTopicHeatmap(samples: AgentTopicSample[]): DashboardHeatmapResult {
  const agents = [...new Set(samples.map((s) => s.agent))].sort();
  const topics = [...new Set(samples.map((s) => s.topic))].sort();
  const idx = new Map<string, AgentTopicSample>();
  for (const s of samples) idx.set(`${s.agent}|${s.topic}`, s);

  const matrix: Array<Array<number | null>> = agents.map((a) =>
    topics.map((t) => {
      const s = idx.get(`${a}|${t}`);
      return s && s.count > 0 ? clamp01(s.successRate) : null;
    })
  );

  const lines: string[] = [];
  lines.push(`| agent \\\\ topic | ${topics.join(" | ")} |`);
  lines.push(`| --- | ${topics.map(() => "---").join(" | ")} |`);
  for (let r = 0; r < agents.length; r++) {
    const cells = matrix[r].map((v) => (v === null ? "·" : `${Math.round(v * 100)}%`));
    lines.push(`| ${agents[r]} | ${cells.join(" | ")} |`);
  }

  return { agents, topics, matrix, markdown: lines.join("\n") };
}

/**
 * Trust score を時間バケット (例 1 日単位) で平均し、エージェント別の時系列を返す。
 * `bucketMs` が省略された場合は 24h。
 */
export function buildAgentTrustScoreTimeline(
  samples: AgentTrustScoreSample[],
  bucketMs: number = 24 * 60 * 60 * 1000
): DashboardTrustTimelineResult {
  if (samples.length === 0) {
    return { agents: [], buckets: [], series: [], markdown: "(no trust score samples)" };
  }
  const agents = [...new Set(samples.map((s) => s.agent))].sort();

  const times = samples
    .map((s) => Date.parse(s.timestamp))
    .filter((t) => Number.isFinite(t));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const bucketCount = Math.min(50, Math.max(1, Math.ceil((maxT - minT) / bucketMs) + 1));
  const buckets: string[] = [];
  for (let i = 0; i < bucketCount; i++) {
    buckets.push(new Date(minT + i * bucketMs).toISOString().slice(0, 10));
  }

  const sums: number[][] = agents.map(() => Array(bucketCount).fill(0));
  const counts: number[][] = agents.map(() => Array(bucketCount).fill(0));
  for (const s of samples) {
    const t = Date.parse(s.timestamp);
    if (!Number.isFinite(t)) continue;
    const ai = agents.indexOf(s.agent);
    const bi = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - minT) / bucketMs)));
    sums[ai][bi] += clamp01(s.trustScore);
    counts[ai][bi] += 1;
  }

  const series: Array<Array<number | null>> = sums.map((row, i) =>
    row.map((sum, j) => (counts[i][j] > 0 ? Number((sum / counts[i][j]).toFixed(3)) : null))
  );

  const lines: string[] = [];
  lines.push(`| agent | ${buckets.join(" | ")} |`);
  lines.push(`| --- | ${buckets.map(() => "---").join(" | ")} |`);
  for (let i = 0; i < agents.length; i++) {
    const cells = series[i].map((v) => (v === null ? "·" : v.toFixed(2)));
    lines.push(`| ${agents[i]} | ${cells.join(" | ")} |`);
  }

  return { agents, buckets, series, markdown: lines.join("\n") };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * A5: Prompt テンプレート自動チューニング
 *
 * 候補となるプロンプトテンプレートと評価サンプル群を受け取り、
 * 平均スコア / 成功率 / トークン効率に基づいて最良テンプレートを選定する。
 *
 * チューナーは純粋関数で副作用を持たない。MCP ハンドラ層が
 * `evaluate_prompt_metrics` などの計測結果を渡す前提。
 */

export interface PromptSample {
  /** 評価器が返したスコア (0..1 を想定。範囲外でもクリップ) */
  score: number;
  /** 推定/実測トークン数 (省略時はトークン効率を 0 として無視) */
  tokens?: number;
  /** 利用結果が成功と見做されたか */
  success?: boolean;
}

export interface PromptTemplateInput {
  name: string;
  content?: string;
  samples: PromptSample[];
}

export interface TuneOptions {
  /** これ未満のサンプル数のテンプレートはランキング下位かつ retire 対象とする */
  minSamples?: number;
  /** リーダーがこの値より低い場合は promote しない */
  promoteThreshold?: number;
  /** リーダーとの平均スコア差がこの値以上のテンプレートを retire 候補にする */
  retireScoreGap?: number;
  /** スコア関数の重み (合計 1 推奨)。未指定はデフォルト */
  weights?: { score?: number; success?: number; tokens?: number };
}

export interface TemplateMetric {
  name: string;
  sampleSize: number;
  avgScore: number;
  successRate: number;
  avgTokens: number;
  tokenEfficiency: number;
  combinedScore: number;
  reasons: string[];
}

export interface TuneResult {
  leader: string | null;
  ranking: TemplateMetric[];
  recommendations: {
    promote: string | null;
    retire: string[];
    reasons: string[];
  };
}

const DEFAULT_WEIGHTS = { score: 0.6, success: 0.3, tokens: 0.1 };

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function tunePromptTemplates(
  templates: PromptTemplateInput[],
  options: TuneOptions = {}
): TuneResult {
  const minSamples = options.minSamples ?? 3;
  const promoteThreshold = options.promoteThreshold ?? 0.6;
  const retireScoreGap = options.retireScoreGap ?? 0.2;
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };

  // 全テンプレートのトークン平均を集計し、効率スコアの基準を求める
  const allTokenSamples: number[] = [];
  for (const t of templates) {
    for (const s of t.samples) {
      if (typeof s.tokens === "number" && s.tokens > 0) allTokenSamples.push(s.tokens);
    }
  }
  const tokenBaseline = allTokenSamples.length > 0 ? average(allTokenSamples) : 0;

  const metrics: TemplateMetric[] = templates.map((t) => {
    const sampleSize = t.samples.length;
    const scores = t.samples.map((s) => clamp01(s.score));
    const avgScore = average(scores);
    const successCount = t.samples.filter((s) => s.success === true).length;
    const successRate = sampleSize > 0 ? successCount / sampleSize : 0;
    const tokenSamples = t.samples
      .map((s) => s.tokens)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const avgTokens = tokenSamples.length > 0 ? average(tokenSamples) : 0;
    // 少ないトークンほど効率が高い: baseline / avg を 0..1 にクリップ
    const tokenEfficiency = avgTokens > 0 && tokenBaseline > 0
      ? clamp01(tokenBaseline / avgTokens)
      : 0;

    const combinedScore =
      avgScore * weights.score +
      successRate * weights.success +
      tokenEfficiency * weights.tokens;

    const reasons: string[] = [];
    if (sampleSize < minSamples) reasons.push(`low-samples:${sampleSize}<${minSamples}`);
    if (avgScore < promoteThreshold) reasons.push(`avg-score-below-threshold:${avgScore.toFixed(3)}`);
    if (successRate >= 0.8) reasons.push(`high-success-rate:${successRate.toFixed(2)}`);
    if (tokenEfficiency >= 0.8) reasons.push(`token-efficient:${tokenEfficiency.toFixed(2)}`);

    return {
      name: t.name,
      sampleSize,
      avgScore: Number(avgScore.toFixed(4)),
      successRate: Number(successRate.toFixed(4)),
      avgTokens: Number(avgTokens.toFixed(2)),
      tokenEfficiency: Number(tokenEfficiency.toFixed(4)),
      combinedScore: Number(combinedScore.toFixed(4)),
      reasons
    };
  });

  // ソート: combinedScore desc, sampleSize desc, name asc
  const ranking = [...metrics].sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
    return a.name.localeCompare(b.name);
  });

  const eligible = ranking.filter((m) => m.sampleSize >= minSamples);
  const leader = eligible[0] ?? null;

  const recommendationReasons: string[] = [];
  let promote: string | null = null;

  if (!leader) {
    recommendationReasons.push(`no-template-meets-min-samples:${minSamples}`);
  } else if (leader.avgScore < promoteThreshold) {
    recommendationReasons.push(`leader-below-promote-threshold:${leader.avgScore}<${promoteThreshold}`);
  } else {
    promote = leader.name;
    recommendationReasons.push(
      `promote:${leader.name} score=${leader.avgScore} success=${leader.successRate}`
    );
  }

  const retire: string[] = [];
  if (leader) {
    for (const m of ranking) {
      if (m.name === leader.name) continue;
      if (m.sampleSize < minSamples) {
        retire.push(m.name);
        recommendationReasons.push(`retire:${m.name}=insufficient-samples`);
        continue;
      }
      const gap = leader.avgScore - m.avgScore;
      if (gap >= retireScoreGap) {
        retire.push(m.name);
        recommendationReasons.push(`retire:${m.name}=score-gap=${gap.toFixed(3)}`);
      }
    }
  }

  return {
    leader: leader?.name ?? null,
    ranking,
    recommendations: { promote, retire, reasons: recommendationReasons }
  };
}

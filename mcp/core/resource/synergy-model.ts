/**
 * Agent×Skill Synergy Model (TASK-043)
 *
 * 過去 trace の (agent, skill) 共起と成功率から、組合せの「相性」を学習する。
 *
 * - synergy score = Laplace smoothed success rate × log(共起回数 + 1)
 * - `recommendCombo(topic, agents, skills)` で候補からトップ組合せを返す
 * - `getSynergyBonus(agent, skill)` は trust score / ranking への加点用 0..1
 *
 * 入力は trace のような汎用 record で受け取り、永続化は呼び出し側が担当する。
 * 純粋関数化することで unit test と再計算 (window 切替) を容易にする。
 */

export interface SynergyTraceRecord {
  agent: string;
  skill: string;
  /** true = 成功, false = 失敗。trace の status に対応 */
  success: boolean;
  /** ISO timestamp。指定されると recency 加点 (任意) */
  endedAt?: string;
}

export interface PairStats {
  agent: string;
  skill: string;
  count: number;
  successCount: number;
  /** Laplace smoothed success rate */
  successRate: number;
  /** 0..1 の正規化済 synergy score */
  synergyScore: number;
}

export interface SynergyModel {
  /** key = `${agent}::${skill}` */
  pairs: Map<string, PairStats>;
  /** 全 record 数 (フィルタ後) */
  totalRecords: number;
  /** 学習に使った最大 synergyScore (正規化のため) */
  maxRawScore: number;
}

const PAIR_DELIM = "::";

function pairKey(agent: string, skill: string): string {
  return `${agent}${PAIR_DELIM}${skill}`;
}

/**
 * trace 群から synergy model を構築する。
 *
 * - Laplace smoothing: (success + 1) / (count + 2)
 * - 共起回数の重み: log(count + 1) を掛けることで、サンプル不足の偶然成功を抑制
 * - 最終 synergyScore は 0..1 に正規化（モデル内最大で割る）
 */
export function buildSynergyModel(records: SynergyTraceRecord[]): SynergyModel {
  const aggregated = new Map<string, { agent: string; skill: string; count: number; successCount: number }>();

  for (const r of records) {
    if (!r.agent || !r.skill) continue;
    const key = pairKey(r.agent, r.skill);
    const existing = aggregated.get(key);
    if (existing) {
      existing.count += 1;
      if (r.success) existing.successCount += 1;
    } else {
      aggregated.set(key, {
        agent: r.agent,
        skill: r.skill,
        count: 1,
        successCount: r.success ? 1 : 0
      });
    }
  }

  // raw score 計算
  const rawPairs: Array<PairStats & { rawScore: number }> = [];
  let maxRawScore = 0;
  for (const stats of aggregated.values()) {
    const successRate = (stats.successCount + 1) / (stats.count + 2);
    const rawScore = successRate * Math.log(stats.count + 1);
    if (rawScore > maxRawScore) maxRawScore = rawScore;
    rawPairs.push({
      agent: stats.agent,
      skill: stats.skill,
      count: stats.count,
      successCount: stats.successCount,
      successRate,
      synergyScore: 0,
      rawScore
    });
  }

  const pairs = new Map<string, PairStats>();
  for (const p of rawPairs) {
    const synergyScore = maxRawScore > 0 ? p.rawScore / maxRawScore : 0;
    pairs.set(pairKey(p.agent, p.skill), {
      agent: p.agent,
      skill: p.skill,
      count: p.count,
      successCount: p.successCount,
      successRate: p.successRate,
      synergyScore
    });
  }

  return {
    pairs,
    totalRecords: records.length,
    maxRawScore
  };
}

/**
 * 任意の (agent, skill) 組合せの synergy bonus 0..1 を返す。
 * 学習データが無い場合は 0。
 */
export function getSynergyBonus(model: SynergyModel, agent: string, skill: string): number {
  const stats = model.pairs.get(pairKey(agent, skill));
  return stats?.synergyScore ?? 0;
}

export interface RecommendComboInput {
  agents: string[];
  skills: string[];
  /** 返す上位 N 組合せ。デフォルト 3 */
  limit?: number;
  /** synergyScore がこの値未満の組合せは捨てる。デフォルト 0 */
  minScore?: number;
}

export interface ComboRecommendation {
  agent: string;
  skill: string;
  synergyScore: number;
  successRate: number;
  count: number;
}

/**
 * 候補 agents × candidates skills の全組合せから synergy 上位を返す。
 *
 * 学習データに無い組合せはスコア 0 になるためデフォルトで除外される。
 */
export function recommendCombo(
  model: SynergyModel,
  input: RecommendComboInput
): ComboRecommendation[] {
  const limit = input.limit ?? 3;
  const minScore = input.minScore ?? 0;

  const candidates: ComboRecommendation[] = [];
  for (const agent of input.agents) {
    for (const skill of input.skills) {
      const stats = model.pairs.get(pairKey(agent, skill));
      if (!stats) continue;
      if (stats.synergyScore < minScore) continue;
      candidates.push({
        agent,
        skill,
        synergyScore: stats.synergyScore,
        successRate: stats.successRate,
        count: stats.count
      });
    }
  }

  return candidates
    .sort((a, b) => b.synergyScore - a.synergyScore)
    .slice(0, limit);
}

/**
 * trace 配列 (汎用形) から SynergyTraceRecord に正規化するヘルパ。
 *
 * trace.metadata.agent と trace.metadata.skills (string[]) を読み、
 * skill が複数あれば組合せを展開する。
 */
export function extractSynergyRecordsFromTraces(
  traces: Array<{
    status: "running" | "success" | "error";
    endedAt?: string;
    metadata?: Record<string, unknown>;
  }>
): SynergyTraceRecord[] {
  const records: SynergyTraceRecord[] = [];
  for (const trace of traces) {
    if (trace.status === "running") continue;
    const meta = trace.metadata ?? {};
    const agent = typeof meta.agent === "string" ? meta.agent : null;
    const skillsRaw = meta.skills;
    if (!agent) continue;
    const skills = Array.isArray(skillsRaw)
      ? skillsRaw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    if (skills.length === 0) continue;
    const success = trace.status === "success";
    for (const skill of skills) {
      records.push({ agent, skill, success, endedAt: trace.endedAt });
    }
  }
  return records;
}

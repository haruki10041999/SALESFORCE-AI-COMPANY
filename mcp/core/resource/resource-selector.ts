/**
 * Resource Selector
 * 
 * リソース（skills, tools, presets）のスコアリングと選択を行う
 * スコアリング式：
 *   score = nameMatch + tagMatch + descriptionMatch + usageScore - bugPenalty + recencyBonus
 */

export type ResourceType = "skills" | "tools" | "presets";

/**
 * リソース選択結果
 */
export interface ResourceSelectionResult {
  resourceType: ResourceType;
  selected: string[];
  detail: ResourceScoreDetail[];
  maxScore: number;
  isGap: boolean; // topScore < threshold の場合 true
  threshold: number;
}

/**
 * スコア詳細
 */
export interface ResourceScoreDetail {
  name: string;
  score: number;
  breakdown: ScoreBreakdown;
  disabled: boolean;
}

/**
 * スコア内訳
 */
export interface ScoreBreakdown {
  nameMatch: number;
  tagMatch: number;
  descriptionMatch: number;
  usageScore: number;
  bugPenalty: number;
  recencyBonus: number;
}

/**
 * リソースメタデータ（選択対象）
 */
export interface ResourceCandidate {
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  summary?: string;
  usage?: number;
  bugSignals?: number;
  createdAt?: string;
  updatedAt?: string;
  disabled?: boolean;
}

/**
 * スコアリング設定
 */
export interface ScoringConfig {
  // マッチング重みづけ
  exactNameMatchWeight: number; // 完全一致
  nameContainWeight: number; // 名前に含まれる
  tokenMatchWeight: number; // トークンマッチ
  
  // 品質ボーナス
  tagMatchWeight: number; // タグマッチ
  descriptionMatchWeight: number; // 説明マッチ
  
  // 使用スコア
  usageWeight: number; // 使用回数（スケール調整）
  
  // バグペナルティ
  bugPenaltyWeight: number; // バグシグナル当たりのペナルティ
  
  // 時間ボーナス
  recencyBonusWeight: number; // 新しいリソースへのボーナス
  dayWindow: number; // 何日以内が新規とみなすか
  
  // ギャップ検知
  gapThreshold: number; // topScore < この値で gap判定
}

/**
 * デフォルトスコアリング設定
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  exactNameMatchWeight: 30,
  nameContainWeight: 12,
  tokenMatchWeight: 4,
  tagMatchWeight: 8,
  descriptionMatchWeight: 6,
  usageWeight: 0.5, // 使用回数は緩くスケール
  bugPenaltyWeight: 3,
  recencyBonusWeight: 5,
  dayWindow: 7,
  gapThreshold: 5
};

/**
 * テキスト正規化
 */
function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[\s_\-\/]+/g, " ").trim();
}

/**
 * トークン化
 */
function tokenize(text: string): string[] {
  return normalizeForSearch(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * 単一候補のスコアリング計算
 */
export function scoreCandidate(
  candidate: ResourceCandidate,
  query: string,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): number {
  const breakdown = calculateScoreBreakdown(candidate, query, config);
  return (
    breakdown.nameMatch +
    breakdown.tagMatch +
    breakdown.descriptionMatch +
    breakdown.usageScore -
    breakdown.bugPenalty +
    breakdown.recencyBonus
  );
}

/**
 * スコア内訳を計算
 */
export function calculateScoreBreakdown(
  candidate: ResourceCandidate,
  query: string,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ScoreBreakdown {
  const normalizedQuery = normalizeForSearch(query);
  const queryTokens = tokenize(query);

  let nameMatch = 0;
  let tagMatch = 0;
  let descriptionMatch = 0;
  let usageScore = 0;
  let bugPenalty = 0;
  let recencyBonus = 0;

  // ===== nameMatch =====
  if (candidate.name) {
    const normalizedName = normalizeForSearch(candidate.name);
    if (normalizedName === normalizedQuery) {
      nameMatch += config.exactNameMatchWeight;
    } else if (normalizedName.includes(normalizedQuery)) {
      nameMatch += config.nameContainWeight;
    }
    // トークン単位でのマッチ
    for (const token of queryTokens) {
      if (normalizedName.includes(token)) {
        nameMatch += config.tokenMatchWeight;
      }
    }
  }

  // ===== tagMatch =====
  if (candidate.tags && candidate.tags.length > 0) {
    const normalizedTags = candidate.tags.map((t) => normalizeForSearch(t));
    for (const token of queryTokens) {
      for (const tag of normalizedTags) {
        if (tag.includes(token)) {
          tagMatch += config.tagMatchWeight;
        }
      }
    }
  }

  // ===== descriptionMatch =====
  const descriptions = [
    candidate.description,
    candidate.summary,
    candidate.title
  ].filter((d) => d);

  for (const desc of descriptions) {
    if (!desc) continue;
    const normalizedDesc = normalizeForSearch(desc);
    if (normalizedDesc.includes(normalizedQuery)) {
      descriptionMatch += config.descriptionMatchWeight;
    }
    // トークン単位でのマッチ
    for (const token of queryTokens) {
      if (normalizedDesc.includes(token)) {
        descriptionMatch += config.descriptionMatchWeight * 0.5;
      }
    }
  }

  // ===== usageScore =====
  if (candidate.usage !== undefined && candidate.usage > 0) {
    usageScore = Math.log(candidate.usage + 1) * config.usageWeight;
  }

  // ===== bugPenalty =====
  if (candidate.bugSignals !== undefined && candidate.bugSignals > 0) {
    bugPenalty = candidate.bugSignals * config.bugPenaltyWeight;
  }

  // ===== recencyBonus =====
  if (candidate.createdAt || candidate.updatedAt) {
    const timestamp = candidate.updatedAt || candidate.createdAt;
    if (timestamp) {
      const createdDate = new Date(timestamp);
      const now = new Date();
      const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diffDays < config.dayWindow) {
        recencyBonus = config.recencyBonusWeight * (1 - diffDays / config.dayWindow);
      }
    }
  }

  return {
    nameMatch,
    tagMatch,
    descriptionMatch,
    usageScore,
    bugPenalty,
    recencyBonus
  };
}

/**
 * リソース候補をスコアリングして選択
 */
export function selectResources(
  candidates: ResourceCandidate[],
  query: string,
  limit: number = 3,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): {
  selected: ResourceScoreDetail[];
  maxScore: number;
  isGap: boolean;
} {
  const scored = candidates
    .filter((c) => !c.disabled)
    .map((candidate) => {
      const score = scoreCandidate(candidate, query, config);
      const breakdown = calculateScoreBreakdown(candidate, query, config);
      return {
        name: candidate.name,
        score,
        breakdown,
        disabled: candidate.disabled ?? false
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const maxScore = scored[0]?.score ?? 0;
  const isGap = maxScore < config.gapThreshold;

  return {
    selected: scored,
    maxScore,
    isGap
  };
}

/**
 * リソース選択の実行
 */
export function selectResourcesByType(
  resourceType: ResourceType,
  candidates: ResourceCandidate[],
  query: string,
  limit: number = 3,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ResourceSelectionResult {
  const { selected, maxScore, isGap } = selectResources(
    candidates,
    query,
    limit,
    config
  );

  return {
    resourceType,
    selected: selected.map((s) => s.name),
    detail: selected,
    maxScore,
    isGap,
    threshold: config.gapThreshold
  };
}

/**
 * Resource Selector
 * 
 * リソース（skills, tools, presets）のスコアリングと選択を行う
 * スコアリング式：
 *   score = nameMatch + tagMatch + descriptionMatch + usageScore - bugPenalty + recencyBonus
 */

import {
  rankBySemanticHybrid,
  type SemanticRankInput,
  type SemanticRankResult
} from "./embedding-ranker.js";

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

  // ===== TASK-042: Embedding hybrid =====
  /** "off" | "hybrid" の切替。デフォルトは "off" で既存挙動互換 */
  embeddingMode?: "off" | "hybrid";
  /** hybrid 時の token weight (0..1)。1=token-only / 0=embedding-only。デフォルト 0.6 */
  embeddingAlpha?: number;
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
 * リソース種別ごとのデフォルトスコアリング設定
 *
 * - skills: 既存ベースライン（標準値）
 * - tools: 名前マッチをやや弱め、バグペナルティを強化（信頼性重視）
 * - presets: ユーザー命名のため exact match を強化、recency を弱める（安定運用重視）
 */
export const DEFAULT_SCORING_CONFIG_BY_TYPE: Record<ResourceType, ScoringConfig> = {
  skills: { ...DEFAULT_SCORING_CONFIG },
  tools: {
    ...DEFAULT_SCORING_CONFIG,
    exactNameMatchWeight: 26,
    nameContainWeight: 10,
    bugPenaltyWeight: 5,
    recencyBonusWeight: 3
  },
  presets: {
    ...DEFAULT_SCORING_CONFIG,
    exactNameMatchWeight: 36,
    nameContainWeight: 14,
    recencyBonusWeight: 2,
    dayWindow: 14,
    gapThreshold: 4
  }
};

/**
 * 与えられたリソース種別に対する scoring config を返す
 */
export function getScoringConfigForType(resourceType: ResourceType): ScoringConfig {
  return DEFAULT_SCORING_CONFIG_BY_TYPE[resourceType] ?? DEFAULT_SCORING_CONFIG;
}

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
 *
 * synergyBonus を渡すと、各候補スコアに `bonus(name) * synergyWeight` を加算する
 * (TASK-043 Agent×Skill Synergy 統合)。
 */
export function selectResources(
  candidates: ResourceCandidate[],
  query: string,
  limit: number = 3,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  synergy?: { bonus: (name: string) => number; weight?: number }
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
        disabled: candidate.disabled ?? false,
        candidate
      };
    })
    .filter((c) => c.score > 0);

  // ===== TASK-042: Embedding hybrid rescore =====
  const useEmbedding = config.embeddingMode === "hybrid";
  let finalScored: typeof scored;
  if (useEmbedding && scored.length > 0) {
    const inputs: SemanticRankInput[] = scored.map((s) => ({
      name: s.name,
      text: [
        s.candidate.name,
        s.candidate.description ?? "",
        s.candidate.summary ?? "",
        s.candidate.title ?? "",
        ...(s.candidate.tags ?? [])
      ].join(" "),
      tokenScore: s.score
    }));
    const hybrid = rankBySemanticHybrid(query, inputs, {
      alpha: config.embeddingAlpha
    });
    const hybridMap = new Map<string, SemanticRankResult>();
    for (const h of hybrid) hybridMap.set(h.name, h);
    finalScored = scored
      .map((s) => {
        const h = hybridMap.get(s.name);
        return h
          ? { ...s, score: h.hybridScore }
          : s;
      });
  } else {
    finalScored = scored;
  }

  // ===== TASK-043: Agent×Skill Synergy bonus =====
  if (synergy) {
    const weight = synergy.weight ?? 1;
    finalScored = finalScored.map((s) => {
      const bonus = synergy.bonus(s.name);
      if (!Number.isFinite(bonus) || bonus <= 0) return s;
      return { ...s, score: s.score + bonus * weight };
    });
  }

  const ranked = finalScored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate: _c, ...rest }) => rest);

  const maxScore = ranked[0]?.score ?? 0;
  const isGap = maxScore < config.gapThreshold;

  return {
    selected: ranked,
    maxScore,
    isGap
  };
}

/**
 * リソース選択の実行
 *
 * config を省略した場合、resourceType に応じた DEFAULT_SCORING_CONFIG_BY_TYPE が使用されます。
 */
export function selectResourcesByType(
  resourceType: ResourceType,
  candidates: ResourceCandidate[],
  query: string,
  limit: number = 3,
  config?: ScoringConfig
): ResourceSelectionResult {
  const effectiveConfig = config ?? getScoringConfigForType(resourceType);
  const { selected, maxScore, isGap } = selectResources(
    candidates,
    query,
    limit,
    effectiveConfig
  );

  return {
    resourceType,
    selected: selected.map((s) => s.name),
    detail: selected,
    maxScore,
    isGap,
    threshold: effectiveConfig.gapThreshold
  };
}

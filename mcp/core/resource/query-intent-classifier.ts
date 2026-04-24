/**
 * Query Intent Classifier
 *
 * 自然言語クエリ（topic 等）を 7 種類の intent に分類し、
 * intent 別の scoring weight オーバーライドを提供する。
 *
 * Intents:
 *   - design     : 設計・アーキテクチャ
 *   - implement  : 実装・コーディング
 *   - debug      : 不具合調査・修正
 *   - optimize   : パフォーマンス・最適化
 *   - review     : レビュー・監査
 *   - document   : ドキュメント作成
 *   - deploy     : デプロイ・リリース
 *   - unknown    : いずれにも該当しない
 */

import type { ScoringConfig } from "./resource-selector.js";
import { DEFAULT_SCORING_CONFIG } from "./resource-selector.js";

export type QueryIntent =
  | "design"
  | "implement"
  | "debug"
  | "optimize"
  | "review"
  | "document"
  | "deploy"
  | "unknown";

export interface QueryIntentResult {
  intent: QueryIntent;
  confidence: number; // 0..1
  scores: Record<QueryIntent, number>;
}

/**
 * intent ごとのキーワード辞書（日本語/英語混在）。
 * すべて lowercased で比較される。
 */
const INTENT_KEYWORDS: Record<Exclude<QueryIntent, "unknown">, string[]> = {
  design: [
    "設計", "アーキテクチャ", "構成", "デザイン",
    "design", "architecture", "blueprint", "schema", "model",
    "diagram", "structure"
  ],
  implement: [
    "実装", "コーディング", "実装する", "作成", "新規", "追加",
    "implement", "build", "create", "develop", "code", "add",
    "feature", "scaffold"
  ],
  debug: [
    "バグ", "不具合", "エラー", "デバッグ", "原因", "再現", "修正",
    "debug", "bug", "error", "fix", "issue", "exception", "stacktrace",
    "trace", "fail", "failure", "broken"
  ],
  optimize: [
    "最適化", "パフォーマンス", "速度", "性能", "改善", "ボトルネック",
    "optimize", "optimise", "performance", "perf", "speed", "latency",
    "bottleneck", "tune", "throughput"
  ],
  review: [
    "レビュー", "確認", "監査", "チェック", "見直し",
    "review", "audit", "inspect", "validate", "verify",
    "code review", "checkup"
  ],
  document: [
    "ドキュメント", "資料", "マニュアル", "説明", "ガイド",
    "document", "documentation", "doc", "docs", "manual",
    "guide", "readme", "spec"
  ],
  deploy: [
    "デプロイ", "リリース", "公開", "本番", "リリース準備",
    "deploy", "deployment", "release", "ship", "publish",
    "rollout", "go-live", "production"
  ]
};

/**
 * 与えられたクエリから intent を分類
 */
export function classifyQueryIntent(query: string): QueryIntentResult {
  const normalized = query.toLowerCase();
  const scores: Record<QueryIntent, number> = {
    design: 0,
    implement: 0,
    debug: 0,
    optimize: 0,
    review: 0,
    document: 0,
    deploy: 0,
    unknown: 0
  };

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as Array<
    [Exclude<QueryIntent, "unknown">, string[]]
  >) {
    for (const kw of keywords) {
      if (!kw) continue;
      const lower = kw.toLowerCase();
      if (normalized.includes(lower)) {
        // 長い語ほどシグナルが強い
        scores[intent] += 1 + Math.min(3, Math.floor(lower.length / 6));
      }
    }
  }

  let bestIntent: QueryIntent = "unknown";
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores) as Array<[QueryIntent, number]>) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = total === 0 ? 0 : Number((bestScore / total).toFixed(3));

  return {
    intent: bestIntent,
    confidence,
    scores
  };
}

/**
 * intent 別の scoring weight オーバーライドプリセット。
 * `applyIntentScoringOverride` で base config に部分マージされる。
 */
export const INTENT_SCORING_OVERRIDES: Record<QueryIntent, Partial<ScoringConfig>> = {
  design: {
    // 設計時は説明・タグマッチを優先、recency は弱め
    descriptionMatchWeight: 9,
    tagMatchWeight: 10,
    recencyBonusWeight: 3
  },
  implement: {
    // 実装時は名前一致を強め
    exactNameMatchWeight: 34,
    nameContainWeight: 14
  },
  debug: {
    // デバッグ時は bug penalty を強化、recency を弱め（安定したものを優先）
    bugPenaltyWeight: 6,
    recencyBonusWeight: 2,
    descriptionMatchWeight: 8
  },
  optimize: {
    // 最適化時は usage の多さを重視（実績あるリソース）
    usageWeight: 1.0,
    bugPenaltyWeight: 4
  },
  review: {
    // レビュー時はバランス重視、極端な weight を抑える
    exactNameMatchWeight: 26,
    descriptionMatchWeight: 8,
    tagMatchWeight: 9
  },
  document: {
    // ドキュメント時はタグマッチを重視
    tagMatchWeight: 12,
    descriptionMatchWeight: 9,
    exactNameMatchWeight: 28
  },
  deploy: {
    // デプロイ時は信頼性重視（bug penalty 強化、recency 弱め）
    bugPenaltyWeight: 5,
    recencyBonusWeight: 2,
    exactNameMatchWeight: 32
  },
  unknown: {}
};

/**
 * base config に intent override を部分マージして新しい ScoringConfig を返す。
 */
export function applyIntentScoringOverride(
  base: ScoringConfig,
  intent: QueryIntent
): ScoringConfig {
  const override = INTENT_SCORING_OVERRIDES[intent] ?? {};
  return { ...base, ...override };
}

/**
 * 与えられたクエリから intent を分類し、調整済み ScoringConfig を返すヘルパー。
 */
export function getScoringConfigForQuery(
  query: string,
  base: ScoringConfig = DEFAULT_SCORING_CONFIG
): { intent: QueryIntentResult; config: ScoringConfig } {
  const intent = classifyQueryIntent(query);
  const config = applyIntentScoringOverride(base, intent.intent);
  return { intent, config };
}

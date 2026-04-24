/**
 * Embedding-based Semantic Ranker (TASK-042)
 *
 * 目的:
 * - skill / agent description を「意味類似度」で再ランキングできるようにする
 * - 既存 token-based score と weighted hybrid (α·tokenScore + (1-α)·embedScore) で
 *   表記ゆれ・同義語・部分一致への耐性を向上させる
 *
 * 設計方針:
 * - 外部 API に依存しない決定的 embedding として、文字 n-gram (bigram + trigram) の
 *   TF ベクトルを採用し、コサイン類似度で比較する
 * - "embedding" と呼ぶ抽象を keep して将来 OpenAI / sentence-transformers に
 *   差し替え可能にする
 * - 入出力は純粋関数とし、副作用を持たない
 */

export interface EmbeddingVector {
  /** 次元 (ngram) → 重み */
  terms: Map<string, number>;
  /** L2 ノルム (キャッシュ) */
  norm: number;
}

export interface SemanticRankInput {
  name: string;
  /** 比較対象テキスト (description / summary / tags の連結) */
  text: string;
  /** 既存 token-based score (任意。なければ 0) */
  tokenScore?: number;
}

export interface SemanticRankResult {
  name: string;
  tokenScore: number;
  embeddingScore: number;
  hybridScore: number;
}

export interface SemanticRankOptions {
  /** 0 = embedding-only / 1 = token-only / 0.5 = balanced. デフォルト 0.6 */
  alpha?: number;
  /** n-gram のサイズ集合。デフォルト [2, 3] */
  ngramSizes?: number[];
  /** 1.0 にするためのスケーリング基準 (token score を embedding と同オーダーに) */
  tokenScoreScale?: number;
}

const DEFAULT_ALPHA = 0.6;
const DEFAULT_NGRAM_SIZES = [2, 3];
const DEFAULT_TOKEN_SCALE = 10;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_\-\/\.,;:!\?\(\)\[\]\{\}"'`]+/g, " ")
    .trim();
}

/**
 * 文字 n-gram を生成する。長さ n 未満の語はそのまま 1 トークンとして扱う。
 */
function extractNgrams(text: string, sizes: number[]): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const result: string[] = [];
  // 単語境界を保ちつつ char ngram を取る
  for (const word of normalized.split(" ")) {
    if (!word) continue;
    if (word.length === 1) {
      result.push(word);
      continue;
    }
    for (const n of sizes) {
      if (word.length <= n) {
        result.push(word);
        continue;
      }
      for (let i = 0; i <= word.length - n; i++) {
        result.push(word.slice(i, i + n));
      }
    }
  }
  return result;
}

/**
 * テキストから n-gram TF ベクトルを構築する。
 */
export function buildEmbedding(text: string, ngramSizes: number[] = DEFAULT_NGRAM_SIZES): EmbeddingVector {
  const ngrams = extractNgrams(text, ngramSizes);
  const terms = new Map<string, number>();
  for (const g of ngrams) {
    terms.set(g, (terms.get(g) ?? 0) + 1);
  }
  let sumSq = 0;
  for (const v of terms.values()) {
    sumSq += v * v;
  }
  return { terms, norm: Math.sqrt(sumSq) };
}

/**
 * コサイン類似度。両ベクトルが空なら 0。
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  // 小さい方をループする
  const [small, large] = a.terms.size <= b.terms.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small.terms) {
    const other = large.terms.get(term);
    if (other !== undefined) {
      dot += weight * other;
    }
  }
  return dot / (a.norm * b.norm);
}

/**
 * 1 件の候補テキストとクエリの類似度 (0..1) を返す。
 */
export function embeddingSimilarity(
  query: string,
  text: string,
  ngramSizes: number[] = DEFAULT_NGRAM_SIZES
): number {
  const q = buildEmbedding(query, ngramSizes);
  const t = buildEmbedding(text, ngramSizes);
  return cosineSimilarity(q, t);
}

/**
 * α·tokenScore + (1-α)·embedScore のハイブリッドスコアでランキングする。
 *
 * tokenScore は通常 0..数十 のオーダーなので tokenScoreScale で正規化する
 * (デフォルト 10 で割り、上限 1.0 にクリップ)。
 */
export function rankBySemanticHybrid(
  query: string,
  items: SemanticRankInput[],
  options: SemanticRankOptions = {}
): SemanticRankResult[] {
  const alpha = clamp01(options.alpha ?? DEFAULT_ALPHA);
  const ngramSizes = options.ngramSizes ?? DEFAULT_NGRAM_SIZES;
  const tokenScale = options.tokenScoreScale ?? DEFAULT_TOKEN_SCALE;

  if (!query.trim() || items.length === 0) {
    return [];
  }

  const queryVec = buildEmbedding(query, ngramSizes);
  const results: SemanticRankResult[] = items.map((item) => {
    const itemVec = buildEmbedding(item.text, ngramSizes);
    const embeddingScore = cosineSimilarity(queryVec, itemVec);
    const rawTokenScore = item.tokenScore ?? 0;
    const normalizedToken = clamp01(rawTokenScore / tokenScale);
    const hybridScore = alpha * normalizedToken + (1 - alpha) * embeddingScore;
    return {
      name: item.name,
      tokenScore: rawTokenScore,
      embeddingScore,
      hybridScore
    };
  });

  return results.sort((a, b) => b.hybridScore - a.hybridScore);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 既存スコアリング結果に embedding boost を後付けで合成するためのヘルパ。
 * Returns a Map name → hybridScore で、呼び出し側が自分の既存リストをソートし直せる。
 */
export function computeHybridScoreMap(
  query: string,
  items: SemanticRankInput[],
  options?: SemanticRankOptions
): Map<string, SemanticRankResult> {
  const ranked = rankBySemanticHybrid(query, items, options);
  const map = new Map<string, SemanticRankResult>();
  for (const r of ranked) {
    map.set(r.name, r);
  }
  return map;
}

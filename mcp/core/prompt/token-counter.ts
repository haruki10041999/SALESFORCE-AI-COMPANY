/**
 * F-06: Token Counter
 *
 * `js-tiktoken` の `cl100k_base` エンコーディングを用いたトークン数カウンタ。
 * - エンコーディングはプロセス内で 1 度だけロードしてキャッシュ。
 * - ロード失敗時は `Math.ceil(text.length / 4)` の素朴推定にフォールバック。
 * - 純粋関数のみを公開し、副作用は持たない (内部キャッシュを除く)。
 */

import { getEncoding, type Tiktoken } from "js-tiktoken";

export type EncodingName = "cl100k_base" | "o200k_base" | "p50k_base" | "r50k_base";

interface EncodingCache {
  name: EncodingName;
  encoder: Tiktoken | null;
  failed: boolean;
}

const ENCODING_CACHE = new Map<EncodingName, EncodingCache>();

function loadEncoding(name: EncodingName): EncodingCache {
  const cached = ENCODING_CACHE.get(name);
  if (cached) return cached;

  const entry: EncodingCache = { name, encoder: null, failed: false };
  try {
    entry.encoder = getEncoding(name);
  } catch {
    entry.failed = true;
  }
  ENCODING_CACHE.set(name, entry);
  return entry;
}

/**
 * 素朴推定: 4 文字 ≒ 1 token。tiktoken が使えない場合のフォールバック。
 */
export function estimateTokensApprox(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface CountTokensResult {
  /** トークン数 */
  tokens: number;
  /** カウントに使用した方法 */
  method: "tiktoken" | "approx";
  /** 利用したエンコーディング (approx の場合は undefined) */
  encoding?: EncodingName;
}

export interface CountTokensOptions {
  /** 既定: "cl100k_base" (GPT-4 / GPT-3.5-turbo 互換) */
  encoding?: EncodingName;
}

/**
 * テキストのトークン数を返す。tiktoken 失敗時は approx へフォールバック。
 */
export function countTokens(text: string, options: CountTokensOptions = {}): CountTokensResult {
  if (!text) return { tokens: 0, method: "tiktoken", encoding: options.encoding ?? "cl100k_base" };

  const encoding = options.encoding ?? "cl100k_base";
  const entry = loadEncoding(encoding);
  if (entry.encoder && !entry.failed) {
    try {
      const tokens = entry.encoder.encode(text).length;
      return { tokens, method: "tiktoken", encoding };
    } catch {
      // 単発の失敗ではキャッシュを破棄せず、今回だけ approx へ
    }
  }
  return { tokens: estimateTokensApprox(text), method: "approx" };
}

/**
 * `countTokens` の薄いラッパで数値のみ返す。テストや UI での簡易呼び出し向け。
 */
export function tokenCount(text: string, options: CountTokensOptions = {}): number {
  return countTokens(text, options).tokens;
}

/**
 * 複数テキストの合計トークン数。境界トークンの誤差を避けるため、個別カウントを単純合計する。
 */
export function sumTokenCount(texts: ReadonlyArray<string>, options: CountTokensOptions = {}): number {
  let total = 0;
  for (const t of texts) total += tokenCount(t, options);
  return total;
}

/**
 * テスト用。キャッシュを破棄する。
 */
export function _resetTokenCounterCache(): void {
  ENCODING_CACHE.clear();
}

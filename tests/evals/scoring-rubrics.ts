/**
 * T-09: Eval Harness – Scoring Rubrics
 *
 * よく使うスコアリングロジックをここに集約。
 * 個別の *.eval.ts から import して使う。
 */

import type { EvalRubric } from "../../mcp/core/learning/eval-harness.js";

// ── keyword-based rubrics ───────────────────────────────────────────────────

/** 出力テキストに全キーワードが含まれることを確認するルーブリック */
export function allKeywordsPresent(keywords: string[]): EvalRubric {
  return {
    mustContain: keywords,
    minScore: 1.0
  };
}

/** 出力テキストに少なくとも N 個のキーワードが含まれることを確認するルーブリック */
export function atLeastNKeywords(keywords: string[], n: number): EvalRubric {
  return {
    scorer: (output) => {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const lc = text.toLowerCase();
      const matched = keywords.filter((kw) => lc.includes(kw.toLowerCase())).length;
      return matched / keywords.length >= n / keywords.length ? 1 : matched / keywords.length;
    },
    minScore: n / keywords.length
  };
}

/** JSON 出力に特定のフィールドが存在することを確認するルーブリック */
export function hasJsonFields(fields: string[]): EvalRubric {
  return {
    scorer: (output) => {
      let obj: unknown;
      if (typeof output === "object" && output !== null) {
        obj = output;
      } else if (typeof output === "string") {
        try { obj = JSON.parse(output); } catch { return 0; }
      } else {
        return 0;
      }
      const matched = fields.filter((f) => f in (obj as Record<string, unknown>)).length;
      return matched / fields.length;
    },
    minScore: 1.0
  };
}

/** MCP ツールの content 配列レスポンスを評価するルーブリック */
export function mcpContentContains(keywords: string[]): EvalRubric {
  return {
    scorer: (output) => {
      const text = Array.isArray(output)
        ? output.map((item) => {
            if (typeof item === "object" && item !== null && "text" in item) {
              return String((item as { text?: unknown }).text ?? "");
            }
            return JSON.stringify(item);
          }).join(" ").toLowerCase()
        : typeof output === "string" ? output.toLowerCase() : JSON.stringify(output).toLowerCase();

      const matched = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
      return keywords.length === 0 ? 1 : matched / keywords.length;
    },
    minScore: 0.8
  };
}

/** ツール実行が成功（エラーなし）かを確認するルーブリック */
export const successRubric: EvalRubric = {
  mustNotContain: ["error", "exception", "failed", "エラー"],
  minScore: 1.0
};

/** 品質スコアが一定以上であることを確認するルーブリック（0–1 のスコアを返す関数が output の場合） */
export function minQualityScore(threshold: number): EvalRubric {
  return {
    scorer: (output) => {
      if (typeof output === "number") {
        return output >= threshold ? 1 : output / threshold;
      }
      if (typeof output === "object" && output !== null && "score" in output) {
        const s = Number((output as { score?: unknown }).score);
        return Number.isFinite(s) ? (s >= threshold ? 1 : s / threshold) : 0;
      }
      return 0;
    },
    minScore: 1.0
  };
}

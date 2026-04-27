/**
 * F-07: Quality Rubric — LLM-as-Judge for prompt/response quality
 *
 * 5 軸の評価基準を JSON で要求する rubric prompt を構築し、Ollama 応答を
 * パースして 0..10 のスコアと理由付きの詳細を返す。
 *
 * 評価軸 (デフォルト):
 *  - relevance      : ユーザ要求への適合度
 *  - completeness   : 必要要素 (Apex/Flow/Test 等) の網羅
 *  - actionability  : 実行可能な具体性
 *  - safety         : セキュリティ・コンプラ違反の有無
 *  - structure      : セクション・順序の論理性
 *
 * - 副作用は Ollama 呼び出しのみ。失敗時は heuristic スコアにフォールバック。
 * - judge モデル不在 / タイムアウト時は呼び出し側がスコア未確定として扱える。
 */

import { OllamaClient, getDefaultOllamaClient, OllamaError } from "./ollama-client.js";

export interface QualityCriterion {
  /** 安定 ID。JSON のキーになる */
  id: string;
  /** judge プロンプト用のラベル */
  label: string;
  /** judge プロンプト用の補助説明 */
  description: string;
  /** 重み (0..1)。合計が 1 になるよう正規化 */
  weight: number;
}

export const DEFAULT_RUBRIC_CRITERIA: ReadonlyArray<QualityCriterion> = Object.freeze([
  {
    id: "relevance",
    label: "Relevance",
    description: "ユーザの依頼・トピックに対する適合度。脱線や論点ずれを減点。",
    weight: 0.25
  },
  {
    id: "completeness",
    label: "Completeness",
    description: "Salesforce 要素 (Apex / LWC / Flow / 権限 / テスト) を必要に応じ網羅。",
    weight: 0.2
  },
  {
    id: "actionability",
    label: "Actionability",
    description: "実装手順・コード例・確認手順が具体的で再現可能か。",
    weight: 0.2
  },
  {
    id: "safety",
    label: "Safety",
    description: "セキュリティ / プライバシー / Governor Limits 違反を含まない。",
    weight: 0.2
  },
  {
    id: "structure",
    label: "Structure",
    description: "セクションの論理順序、見出しの整理、要約と詳細の分離。",
    weight: 0.15
  }
]);

export interface CriterionScore {
  id: string;
  /** 0..10 整数または小数 */
  score: number;
  rationale: string;
}

export interface QualityRubricResult {
  /** 0..10 (0..1 でなく分かりやすく 10 段階) */
  overallScore: number;
  criteria: CriterionScore[];
  /** "judge" = LLM 評価, "heuristic" = フォールバック */
  method: "judge" | "heuristic";
  /** 利用 model (heuristic 時 undefined) */
  model?: string;
  /** raw judge response (debug 用、heuristic 時 undefined) */
  rawJudgeResponse?: string;
}

export interface EvaluateRubricOptions {
  client?: OllamaClient;
  model?: string;
  criteria?: ReadonlyArray<QualityCriterion>;
  /** タイムアウトを短くしたい場合のオーバーライド (ms) */
  timeoutMs?: number;
  /** judge 失敗時に heuristic にフォールバック。既定 true */
  fallbackOnFailure?: boolean;
  /** 元のユーザ依頼 (rubric prompt 内に含める) */
  topic?: string;
}

/**
 * 軽量ヒューリスティック: structure / completeness を見出しと長さで採点。
 */
export function evaluateHeuristicRubric(
  response: string,
  criteria: ReadonlyArray<QualityCriterion> = DEFAULT_RUBRIC_CRITERIA
): QualityRubricResult {
  const len = response.length;
  const headings = (response.match(/^#{1,6}\s+/gm) ?? []).length;
  const codeBlocks = (response.match(/```/g) ?? []).length / 2;
  const bullets = (response.match(/^[\s]*[-*]\s+/gm) ?? []).length;

  const lengthScore = clamp01(len / 4000) * 10;
  const structureScore = clamp01((headings + codeBlocks * 0.5 + bullets * 0.1) / 6) * 10;
  const completenessScore = clamp01(
    (response.match(/apex|trigger|flow|lwc|permission|test/gi)?.length ?? 0) / 6
  ) * 10;
  const actionabilityScore = clamp01((codeBlocks + bullets / 4) / 4) * 10;
  const safetyScore = /TODO|FIXME|hack|insecure|XSS/i.test(response) ? 5 : 8;

  const map: Record<string, number> = {
    relevance: lengthScore,
    completeness: completenessScore,
    actionability: actionabilityScore,
    safety: safetyScore,
    structure: structureScore
  };

  const items: CriterionScore[] = criteria.map((c) => ({
    id: c.id,
    score: round1(map[c.id] ?? 5),
    rationale: "heuristic estimate"
  }));
  const overall = round1(weightedAverage(items, criteria));
  return { overallScore: overall, criteria: items, method: "heuristic" };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clamp10(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 10) return 10;
  return v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function weightedAverage(scores: CriterionScore[], criteria: ReadonlyArray<QualityCriterion>): number {
  let totalW = 0;
  for (const c of criteria) totalW += c.weight;
  if (totalW === 0) return 0;
  let acc = 0;
  for (const s of scores) {
    const c = criteria.find((cc) => cc.id === s.id);
    if (!c) continue;
    acc += clamp10(s.score) * (c.weight / totalW);
  }
  return acc;
}

export function buildJudgePrompt(
  response: string,
  criteria: ReadonlyArray<QualityCriterion> = DEFAULT_RUBRIC_CRITERIA,
  topic?: string
): string {
  const lines: string[] = [];
  lines.push("あなたは Salesforce 実装レビューの厳格な評価者です。以下の評価基準に従って");
  lines.push("対象の応答を採点してください。各基準ごとに 0..10 の整数または小数で評価し、");
  lines.push("短い理由 (rationale) を付けてください。出力は **JSON のみ** とし、追加文章を入れないでください。");
  lines.push("");
  if (topic) {
    lines.push("## ユーザ依頼");
    lines.push(topic);
    lines.push("");
  }
  lines.push("## 評価基準");
  for (const c of criteria) {
    lines.push(`- id: ${c.id}`);
    lines.push(`  label: ${c.label}`);
    lines.push(`  description: ${c.description}`);
  }
  lines.push("");
  lines.push("## 評価対象");
  lines.push("```");
  lines.push(response);
  lines.push("```");
  lines.push("");
  lines.push("## 出力スキーマ (JSON)");
  lines.push("{");
  lines.push('  "criteria": [');
  lines.push('    { "id": "relevance", "score": 8.0, "rationale": "..." }');
  lines.push("  ]");
  lines.push("}");
  return lines.join("\n");
}

/**
 * judge 応答 (任意の文字列) から JSON 部分を取り出してパース。
 * - ```json ... ``` フェンスを許容
 * - 最初の `{` から対応する `}` までを切り出して JSON.parse
 */
export function parseJudgeResponse(raw: string): { criteria: CriterionScore[] } | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  if (!body) return null;
  const start = body.indexOf("{");
  if (start < 0) return null;
  // 対応する `}` を簡易ブレースカウントで見つける
  let depth = 0;
  let end = -1;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const slice = body.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    if (!obj || !Array.isArray(obj.criteria)) return null;
    const criteria: CriterionScore[] = [];
    for (const item of obj.criteria) {
      if (!item || typeof item.id !== "string") continue;
      const score = typeof item.score === "number" ? item.score : Number.parseFloat(String(item.score));
      if (!Number.isFinite(score)) continue;
      criteria.push({
        id: item.id,
        score: clamp10(score),
        rationale: typeof item.rationale === "string" ? item.rationale : ""
      });
    }
    return { criteria };
  } catch {
    return null;
  }
}

/**
 * Ollama judge を呼び出して評価。失敗時は heuristic にフォールバック。
 */
export async function evaluateQualityRubric(
  response: string,
  options: EvaluateRubricOptions = {}
): Promise<QualityRubricResult> {
  const criteria = options.criteria ?? DEFAULT_RUBRIC_CRITERIA;
  const fallback = options.fallbackOnFailure ?? true;
  const client = options.client ?? getDefaultOllamaClient();
  const model = options.model ?? "qwen2.5:3b";
  const prompt = buildJudgePrompt(response, criteria, options.topic);

  try {
    const out = await client.generate({
      model,
      prompt,
      options: { temperature: 0.0 }
    });
    const parsed = parseJudgeResponse(out.response);
    if (!parsed || parsed.criteria.length === 0) {
      if (fallback) {
        const heur = evaluateHeuristicRubric(response, criteria);
        return { ...heur, rawJudgeResponse: out.response };
      }
      throw new OllamaError("E_RUBRIC_PARSE_FAILED", "judge response could not be parsed");
    }

    // 欠けた criterion は heuristic 推定で補完
    const heur = evaluateHeuristicRubric(response, criteria);
    const merged: CriterionScore[] = criteria.map((c) => {
      const judged = parsed.criteria.find((s) => s.id === c.id);
      if (judged) return { ...judged, score: round1(judged.score) };
      const fb = heur.criteria.find((s) => s.id === c.id)!;
      return { ...fb, rationale: `${fb.rationale} (judge missing)` };
    });
    const overall = round1(weightedAverage(merged, criteria));
    return {
      overallScore: overall,
      criteria: merged,
      method: "judge",
      model,
      rawJudgeResponse: out.response
    };
  } catch (err) {
    if (!fallback) throw err;
    return evaluateHeuristicRubric(response, criteria);
  }
}

import { getDefaultOllamaClient, type OllamaClient } from "../llm/ollama-client.js";
import {
  getRubricJudgeProvider,
  evaluateQualityRubric,
  evaluateHeuristicRubric,
  type QualityRubricResult,
  type RubricJudgeProvider,
  DEFAULT_RUBRIC_CRITERIA,
  type QualityCriterion
} from "../llm/quality-rubric.js";

export interface SelfRefineOptions {
  topic?: string;
  maxIterations?: number;
  targetScore?: number;
  judge?: boolean;
  provider?: RubricJudgeProvider;
  model?: string;
  refineModel?: string;
  minImprovement?: number;
}

export interface SelfRefineIteration {
  iteration: number;
  score: number;
  method: "judge" | "heuristic";
  deltaFromPrevious: number;
}

export interface SelfRefineResult {
  initialText: string;
  finalText: string;
  finalScore: number;
  iterations: SelfRefineIteration[];
  stoppedReason: "target-reached" | "max-iterations" | "no-improvement" | "empty-refine";
}

export interface SelfRefineDeps {
  client?: OllamaClient;
  evaluate?: (text: string) => Promise<QualityRubricResult>;
  refine?: (input: {
    currentText: string;
    topic?: string;
    evaluation: QualityRubricResult;
    iteration: number;
  }) => Promise<string>;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function buildRefineInstruction(input: {
  currentText: string;
  topic?: string;
  evaluation: QualityRubricResult;
  criteria?: ReadonlyArray<QualityCriterion>;
}): string {
  const criteria = input.criteria ?? DEFAULT_RUBRIC_CRITERIA;
  const lines: string[] = [];
  lines.push("以下の応答を、評価スコアを改善するように書き直してください。");
  lines.push("出力は改善後の本文のみを返し、前置き・説明・JSONは不要です。");
  if (input.topic) {
    lines.push("");
    lines.push("## Topic");
    lines.push(input.topic);
  }
  lines.push("");
  lines.push("## Current Response");
  lines.push("```");
  lines.push(input.currentText);
  lines.push("```");
  lines.push("");
  lines.push("## Rubric Scores");
  for (const c of criteria) {
    const score = input.evaluation.criteria.find((x) => x.id === c.id);
    lines.push(`- ${c.id}: ${score?.score ?? "n/a"} (${score?.rationale ?? ""})`);
  }
  lines.push("");
  lines.push("改善方針:");
  lines.push("- 具体性と実行手順を増やす");
  lines.push("- 不足観点を補完する");
  lines.push("- 冗長性を減らして構造化する");
  return lines.join("\n");
}

export async function runSelfRefineLoop(
  initialText: string,
  options: SelfRefineOptions = {},
  deps: SelfRefineDeps = {}
): Promise<SelfRefineResult> {
  const maxIterations = Math.max(1, Math.min(10, options.maxIterations ?? 3));
  const targetScore = Math.max(0, Math.min(10, options.targetScore ?? 8.5));
  const minImprovement = Math.max(0, options.minImprovement ?? 0.2);
  const judge = options.judge === true;
  const provider = options.provider ?? getRubricJudgeProvider();
  const canUseLlmProvider = provider === "ollama";
  const client = canUseLlmProvider ? (deps.client ?? getDefaultOllamaClient()) : undefined;
  const model = options.model ?? "qwen2.5:3b";
  const refineModel = options.refineModel ?? model;

  const evaluate = deps.evaluate ?? (async (text: string) => {
    if (judge) {
      return await evaluateQualityRubric(text, {
        topic: options.topic,
        provider,
        model,
        fallbackOnFailure: true
      });
    }
    return evaluateHeuristicRubric(text, DEFAULT_RUBRIC_CRITERIA);
  });

  const refine = deps.refine ?? (async ({ currentText, topic, evaluation }) => {
    if (!client) {
      return currentText;
    }
    const prompt = buildRefineInstruction({ currentText, topic, evaluation });
    const out = await client.chat({
      model: refineModel,
      messages: [
        {
          role: "system",
          content: "You are an expert writing assistant. Return only the revised response body."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      options: { temperature: 0.2 }
    });
    return (out.message?.content ?? "").trim();
  });

  const iterations: SelfRefineIteration[] = [];
  let current = initialText;
  let previousScore = 0;

  for (let i = 1; i <= maxIterations; i += 1) {
    const evalResult = await evaluate(current);
    const score = round1(evalResult.overallScore);
    const delta = i === 1 ? score : round1(score - previousScore);
    iterations.push({
      iteration: i,
      score,
      method: evalResult.method,
      deltaFromPrevious: delta
    });

    if (score >= targetScore) {
      return {
        initialText,
        finalText: current,
        finalScore: score,
        iterations,
        stoppedReason: "target-reached"
      };
    }

    if (i === maxIterations) {
      return {
        initialText,
        finalText: current,
        finalScore: score,
        iterations,
        stoppedReason: "max-iterations"
      };
    }

    const revised = await refine({
      currentText: current,
      topic: options.topic,
      evaluation: evalResult,
      iteration: i
    });

    if (!revised) {
      return {
        initialText,
        finalText: current,
        finalScore: score,
        iterations,
        stoppedReason: "empty-refine"
      };
    }

    const nextEval = await evaluate(revised);
    const nextScore = round1(nextEval.overallScore);
    if (nextScore - score < minImprovement) {
      return {
        initialText,
        finalText: revised,
        finalScore: nextScore,
        iterations,
        stoppedReason: "no-improvement"
      };
    }

    previousScore = score;
    current = revised;
  }

  const finalEval = await evaluate(current);
  return {
    initialText,
    finalText: current,
    finalScore: round1(finalEval.overallScore),
    iterations,
    stoppedReason: "max-iterations"
  };
}

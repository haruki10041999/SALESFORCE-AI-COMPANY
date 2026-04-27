import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";
import { createLogger } from "../core/logging/logger.js";
import { tunePromptTemplates } from "../tools/tune-prompt-templates.js";
import {
  evaluateQualityRubric,
  evaluateHeuristicRubric,
  DEFAULT_RUBRIC_CRITERIA
} from "../core/llm/quality-rubric.js";

interface RegisterVectorPromptToolsDeps extends RegisterGovToolDeps {
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  /** F-11: vector backend (ngram/ollama) 経由の async 検索。tfidf 固定時は省略可。 */
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
  buildPrompt: (agent: { name: string; content: string }, task: string) => string;
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => {
    lengthChars: number;
    lineCount: number;
    estimatedTokens: number;
    containsProjectContext: boolean;
    containsAgentsSection: boolean;
    containsSkillsSection: boolean;
    containsTaskSection: boolean;
    matchedSkillCount: number;
    totalSkillCount: number;
    matchedTriggerCount: number;
    totalTriggerCount: number;
    skillCoverageRate: number;
    triggerMatchRate: number;
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDiagnostics(metrics: {
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  skillCoverageRate: number;
  triggerMatchRate: number;
  matchedSkillCount: number;
  totalSkillCount: number;
  matchedTriggerCount: number;
  totalTriggerCount: number;
}): {
  sectionCoverageRate: number;
  overallScore: number;
  scoreBreakdown: {
    sectionCoverage: number;
    skillCoverage: number;
    triggerCoverage: number;
  };
  rationale: string[];
} {
  const sectionMatchedCount = [
    metrics.containsProjectContext,
    metrics.containsAgentsSection,
    metrics.containsSkillsSection,
    metrics.containsTaskSection
  ].filter(Boolean).length;
  const sectionCoverageRate = sectionMatchedCount / 4;

  const overallScore = sectionCoverageRate * 0.4 + metrics.skillCoverageRate * 0.3 + metrics.triggerMatchRate * 0.3;
  const rationale: string[] = [];

  if (sectionCoverageRate < 1) {
    rationale.push(`セクション網羅が不足 (${sectionMatchedCount}/4)`);
  }
  if (metrics.totalSkillCount > 0 && metrics.matchedSkillCount < metrics.totalSkillCount) {
    rationale.push(`スキル一致が不足 (${metrics.matchedSkillCount}/${metrics.totalSkillCount})`);
  }
  if (metrics.totalTriggerCount > 0 && metrics.matchedTriggerCount < metrics.totalTriggerCount) {
    rationale.push(`トリガー一致が不足 (${metrics.matchedTriggerCount}/${metrics.totalTriggerCount})`);
  }
  if (rationale.length === 0) {
    rationale.push("主要評価指標はすべて閾値を満たしています。");
  }

  return {
    sectionCoverageRate: round2(sectionCoverageRate),
    overallScore: round2(overallScore),
    scoreBreakdown: {
      sectionCoverage: round2(sectionCoverageRate),
      skillCoverage: round2(metrics.skillCoverageRate),
      triggerCoverage: round2(metrics.triggerMatchRate)
    },
    rationale
  };
}

export function registerVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  const { govTool, addRecord, searchByKeyword, searchByKeywordAsync, buildPrompt, evaluatePromptMetrics } = deps;
  const logger = createLogger("VectorPromptTools");
  const verbosePromptDebug = process.env.SF_AI_DEBUG_VERBOSE_PROMPT === "true";

  govTool(
    "add_vector_record",
    {
      title: "ベクトルレコード追加",
      description: "ベクトルストアにレコードを追加します。",
      inputSchema: {
        id: z.string().min(1),
        text: z.string().min(1),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ id, text, tags }: { id: string; text: string; tags?: string[] }) => {
      addRecord({ id, text, tags: tags ?? [] });
      return {
        content: [{ type: "text", text: `Vector record added: ${id}` }]
      };
    }
  );

  govTool(
    "search_vector",
    {
      title: "ベクトル検索",
      description: "ベクトルストアを検索します。",
      inputSchema: {
        query: z.string().min(1)
      }
    },
    async ({ query }: { query: string }) => {
      // F-11: SF_AI_VECTOR_BACKEND が ngram/ollama の場合は async 経路を使う
      const backend = (process.env.SF_AI_VECTOR_BACKEND ?? "tfidf").toLowerCase();
      const results =
        backend !== "tfidf" && searchByKeywordAsync
          ? await searchByKeywordAsync(query)
          : searchByKeyword(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, count: results.length, backend, results }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "build_prompt",
    {
      title: "プロンプト構築",
      description: "ベースプロンプトと推論フレームワークから単一エージェント用プロンプトを構築します。",
      inputSchema: {
        agentName: z.string(),
        agentContent: z.string(),
        task: z.string()
      }
    },
    async ({ agentName, agentContent, task }: { agentName: string; agentContent: string; task: string }) => {
      const prompt = buildPrompt({ name: agentName, content: agentContent }, task);
      logger.debug("build_prompt completed", {
        agentName,
        taskLength: task.length,
        promptLength: prompt.length,
        promptLineCount: prompt.split(/\r?\n/).length
      });
      if (verbosePromptDebug) {
        logger.debug("build_prompt full prompt", prompt);
      }
      return {
        content: [{ type: "text", text: prompt }]
      };
    }
  );

  govTool(
    "evaluate_prompt_metrics",
    {
      title: "プロンプト評価指標",
      description: "長さ・セクション網羅率・スキル網羅率・トリガー一致率などのプロンプト品質指標を評価します。",
      inputSchema: {
        prompt: z.string().min(1),
        skills: z.array(z.string()).optional(),
        triggerKeywords: z.array(z.string()).optional()
      }
    },
    async ({ prompt, skills, triggerKeywords }: { prompt: string; skills?: string[]; triggerKeywords?: string[] }) => {
      const metrics = evaluatePromptMetrics(prompt, skills, triggerKeywords);
      const diagnostics = buildDiagnostics(metrics);

      logger.debug("evaluate_prompt_metrics completed", {
        promptLength: metrics.lengthChars,
        promptLineCount: metrics.lineCount,
        scoreBreakdown: diagnostics.scoreBreakdown,
        overallScore: diagnostics.overallScore,
        rationale: diagnostics.rationale
      });
      if (verbosePromptDebug) {
        logger.debug("evaluate_prompt_metrics full prompt", prompt);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ ...metrics, diagnostics }, null, 2) }]
      };
    }
  );

  govTool(
    "tune_prompt_templates",
    {
      title: "プロンプトテンプレート自動チューニング",
      description: "複数テンプレートの評価サンプルから最良候補を選定し、promote / retire を提案します。",
      inputSchema: {
        templates: z.array(z.object({
          name: z.string().min(1),
          content: z.string().optional(),
          samples: z.array(z.object({
            score: z.number(),
            tokens: z.number().optional(),
            success: z.boolean().optional()
          }))
        })).min(1),
        minSamples: z.number().int().min(1).max(1000).optional(),
        promoteThreshold: z.number().min(0).max(1).optional(),
        retireScoreGap: z.number().min(0).max(1).optional()
      }
    },
    async ({ templates, minSamples, promoteThreshold, retireScoreGap }: {
      templates: Array<{ name: string; content?: string; samples: Array<{ score: number; tokens?: number; success?: boolean }> }>;
      minSamples?: number;
      promoteThreshold?: number;
      retireScoreGap?: number;
    }) => {
      const result = tunePromptTemplates(templates, { minSamples, promoteThreshold, retireScoreGap });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  // F-10: Quality Rubric を MCP ツールとして公開。
  // judge=true で Ollama judge (qwen2.5:3b) を呼び出し、unavailable / parse 失敗時は heuristic にフォールバック。
  govTool(
    "evaluate_quality_rubric",
    {
      title: "応答品質ルーブリック評価",
      description:
        "応答テキストを relevance/completeness/actionability/safety/structure の 5 観点で 0..5 にスコア化します。judge=true で Ollama judge を呼び、未起動時は heuristic で代替します。",
      inputSchema: {
        response: z.string().min(1),
        topic: z.string().optional(),
        judge: z.boolean().optional(),
        model: z.string().optional()
      }
    },
    async ({ response, topic, judge, model }: {
      response: string;
      topic?: string;
      judge?: boolean;
      model?: string;
    }) => {
      const useJudge = judge === true;
      const result = useJudge
        ? await evaluateQualityRubric(response, {
            ...(topic !== undefined ? { topic } : {}),
            ...(model !== undefined ? { model } : {}),
            fallbackOnFailure: true
          })
        : evaluateHeuristicRubric(response, DEFAULT_RUBRIC_CRITERIA);
      logger.debug("evaluate_quality_rubric completed", {
        method: result.method,
        overallScore: result.overallScore,
        criteriaCount: result.criteria.length
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}


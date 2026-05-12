import { z } from "zod";
import { getVectorBackend } from "../../core/config/runtime-config.js";
import { tunePromptTemplates } from "../../tools/tune-prompt-templates.js";
import {
  executeBuildPrompt,
  executeEvaluatePromptMetrics,
  executeSearchVector
} from "../../core/application/prompt/services/vector-prompt-operations.js";
import type { RegisterVectorPromptToolsDeps } from "../register-vector-prompt-tools.js";
import type { VectorPromptLogging } from "./vector-prompt-tools.js";

export function registerVectorPromptCoreTools(
  deps: RegisterVectorPromptToolsDeps,
  logger: VectorPromptLogging,
  verbosePromptDebug: boolean
): void {
  const { govTool, addRecord, searchByKeyword, searchByKeywordAsync, buildPrompt, evaluatePromptMetrics } = deps;

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
      const backend = getVectorBackend();
      const result = await executeSearchVector({
        query,
        backend,
        searchByKeyword,
        searchByKeywordAsync
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
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
        task: z.string(),
        reasoningStrategy: z.enum(["auto", "plan", "reflect", "tree-of-thought"]).optional(),
        promptVariant: z.enum(["auto", "default", "review", "discussion"]).optional()
      }
    },
    async ({
      agentName,
      agentContent,
      task,
      reasoningStrategy,
      promptVariant
    }: {
      agentName: string;
      agentContent: string;
      task: string;
      reasoningStrategy?: "auto" | "plan" | "reflect" | "tree-of-thought";
      promptVariant?: "auto" | "default" | "review" | "discussion";
    }) => {
      const result = executeBuildPrompt({
        agentName,
        agentContent,
        task,
        reasoningStrategy,
        promptVariant,
        buildPrompt
      });
      logger.debug("build_prompt completed", {
        agentName,
        taskLength: result.taskLength,
        promptLength: result.promptLength,
        promptLineCount: result.promptLineCount
      });
      if (verbosePromptDebug) {
        logger.debug("build_prompt full prompt", { prompt: result.prompt });
      }
      return {
        content: [{ type: "text", text: result.prompt }]
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
      const result = executeEvaluatePromptMetrics({
        prompt,
        skills,
        triggerKeywords,
        evaluatePromptMetrics
      });

      logger.debug("evaluate_prompt_metrics completed", {
        promptLength: result.metricsWithDiagnostics.lengthChars,
        promptLineCount: result.metricsWithDiagnostics.lineCount,
        scoreBreakdown: result.scoreBreakdown,
        overallScore: result.overallScore,
        rationale: result.rationale
      });
      if (verbosePromptDebug) {
        logger.debug("evaluate_prompt_metrics full prompt", { prompt });
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result.metricsWithDiagnostics, null, 2) }]
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
}

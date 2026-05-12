import { z } from "zod";
import {
  executeEvaluateQualityRubric,
  executeSelfRefineResponse
} from "../../core/application/prompt/services/prompt-quality-operations.js";
import type { RegisterVectorPromptToolsDeps } from "../register-vector-prompt-tools.js";
import type { VectorPromptLogging } from "./vector-prompt-tools.js";

export function registerVectorPromptQualityTools(
  deps: RegisterVectorPromptToolsDeps,
  logger: VectorPromptLogging
): void {
  const { govTool } = deps;

  govTool(
    "evaluate_quality_rubric",
    {
      title: "応答品質ルーブリック評価",
      description:
        "応答テキストを relevance/completeness/actionability/safety/structure の 5 観点で 0..5 にスコア化します。judge=true で設定済み provider を呼び、失敗時は heuristic で代替します。",
      inputSchema: {
        response: z.string().min(1),
        topic: z.string().optional(),
        agentName: z.string().optional(),
        judge: z.boolean().optional(),
        model: z.string().optional()
      }
    },
    async ({ response, topic, agentName, judge, model }: {
      response: string;
      topic?: string;
      agentName?: string;
      judge?: boolean;
      model?: string;
    }) => {
      const result = await executeEvaluateQualityRubric({
        response,
        topic,
        agentName,
        judge,
        model
      });
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

  govTool(
    "self_refine_response",
    {
      title: "自己改善ループ",
      description: "応答を quality rubric で評価し、目標スコアまで反復リライトします。",
      inputSchema: {
        response: z.string().min(1),
        topic: z.string().optional(),
        agentName: z.string().optional(),
        maxIterations: z.number().int().min(1).max(10).optional(),
        targetScore: z.number().min(0).max(10).optional(),
        minImprovement: z.number().min(0).max(5).optional(),
        judge: z.boolean().optional(),
        model: z.string().optional(),
        refineModel: z.string().optional()
      }
    },
    async ({
      response,
      topic,
      agentName,
      maxIterations,
      targetScore,
      minImprovement,
      judge,
      model,
      refineModel
    }: {
      response: string;
      topic?: string;
      agentName?: string;
      maxIterations?: number;
      targetScore?: number;
      minImprovement?: number;
      judge?: boolean;
      model?: string;
      refineModel?: string;
    }) => {
      const result = await executeSelfRefineResponse({
        response,
        topic,
        agentName,
        maxIterations,
        targetScore,
        minImprovement,
        judge,
        model,
        refineModel
      });

      logger.debug("self_refine_response completed", {
        iterations: result.iterations.length,
        finalScore: result.finalScore,
        stoppedReason: result.stoppedReason
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

import { getRubricCriteriaOverrideByAgent } from "../../../config/runtime-config.js";
import {
  applyRubricCriteriaOverride,
  evaluateQualityRubric,
  evaluateHeuristicRubric,
  DEFAULT_RUBRIC_CRITERIA
} from "../../../llm/quality-rubric.js";
import { runSelfRefineLoop } from "../../../learning/self-refine-loop.js";

export async function executeEvaluateQualityRubric(args: {
  response: string;
  topic?: string;
  agentName?: string;
  judge?: boolean;
  model?: string;
}) {
  const criteria = args.agentName
    ? applyRubricCriteriaOverride(
        DEFAULT_RUBRIC_CRITERIA,
        getRubricCriteriaOverrideByAgent()[args.agentName]
      )
    : DEFAULT_RUBRIC_CRITERIA;

  const useJudge = args.judge === true;
  return useJudge
    ? evaluateQualityRubric(args.response, {
        ...(args.topic !== undefined ? { topic: args.topic } : {}),
        ...(args.model !== undefined ? { model: args.model } : {}),
        criteria,
        fallbackOnFailure: true
      })
    : evaluateHeuristicRubric(args.response, criteria);
}

export async function executeSelfRefineResponse(args: {
  response: string;
  topic?: string;
  agentName?: string;
  maxIterations?: number;
  targetScore?: number;
  minImprovement?: number;
  judge?: boolean;
  model?: string;
  refineModel?: string;
}) {
  const criteria = args.agentName
    ? applyRubricCriteriaOverride(
        DEFAULT_RUBRIC_CRITERIA,
        getRubricCriteriaOverrideByAgent()[args.agentName]
      )
    : DEFAULT_RUBRIC_CRITERIA;

  return runSelfRefineLoop(args.response, {
    topic: args.topic,
    maxIterations: args.maxIterations,
    targetScore: args.targetScore,
    minImprovement: args.minImprovement,
    judge: args.judge,
    model: args.model,
    refineModel: args.refineModel,
    criteria
  });
}

import { resolve } from "node:path";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import {
  getCriticHeuristicTargetScore,
  getCriticJudgeTargetScore,
  getCriticMinImprovementThreshold,
  getCriticProposalScoreThreshold,
  getOutputsDir
} from "../config/runtime-config.js";
import { runSelfRefineLoop, type SelfRefineIteration, type SelfRefineResult } from "./self-refine-loop.js";
import type { QualityCriterion } from "../llm/quality-rubric.js";
import { createFileProposalQueueStore, type ProposalQueueStore } from "../resource/proposal/proposal-queue-store.js";
import type { CritiqueNextAction, CritiqueRecord } from "../ports/critic.js";
import type { NewProposalInput } from "../resource/proposal/queue.js";

export interface CritiqueLifecycleInput {
  response: string;
  topic?: string;
  agentName?: string;
  sessionId?: string;
  maxIterations?: number;
  targetScore?: number;
  minImprovement?: number;
  judge?: boolean;
  model?: string;
  refineModel?: string;
  criteria?: ReadonlyArray<QualityCriterion>;
}

export interface CritiqueLifecycleDeps {
  proposalQueue?: ProposalQueueStore;
}

export interface CritiqueLifecycleResult extends Omit<SelfRefineResult, "iterations" | "stoppedReason">, Omit<CritiqueRecord, "stoppedReason"> {
  finalText: string;
  iterations: SelfRefineIteration[];
  stoppedReason: SelfRefineResult["stoppedReason"];
  proposalDraft?: {
    title: string;
    body: string;
  };
}

function chooseNextAction(input: {
  finalScore: number;
  targetScore: number;
  proposalScoreThreshold: number;
  qualityImprovement: number;
  minImprovementThreshold: number;
}): CritiqueNextAction {
  const { finalScore, targetScore, proposalScoreThreshold, qualityImprovement, minImprovementThreshold } = input;
  if (finalScore >= targetScore) {
    return "accept";
  }
  if (finalScore >= proposalScoreThreshold && qualityImprovement >= minImprovementThreshold) {
    return "regenerate";
  }
  return "proposal";
}

function buildProposalDraft(input: CritiqueLifecycleResult): { title: string; body: string } | undefined {
  if (input.nextAction !== "proposal") {
    return undefined;
  }

  const title = `Critique follow-up: ${input.agentName ?? "response"} needs a structured proposal`;
  const body = [
    `Topic: ${input.topic ?? "(none)"}`,
    `Session: ${input.sessionId ?? "(none)"}`,
    `Initial score: ${input.initialScore.toFixed(1)}`,
    `Final score: ${input.finalScore.toFixed(1)}`,
    `Improvement: ${input.qualityImprovement.toFixed(1)}`,
    `Stopped reason: ${input.stoppedReason}`,
    "",
    "Recommended action: capture the missing rubric gaps as a proposal before retrying."
  ].join("\n");

  return { title, body };
}

function buildProposalInput(input: CritiqueLifecycleResult): NewProposalInput {
  return {
    resourceType: "tools",
    name: `critique-${input.sessionId ?? input.agentName ?? "response"}`,
    content: buildProposalDraft(input)?.body ?? JSON.stringify({
      topic: input.topic,
      sessionId: input.sessionId,
      agentName: input.agentName,
      initialScore: input.initialScore,
      finalScore: input.finalScore,
      qualityImprovement: input.qualityImprovement,
      stoppedReason: input.stoppedReason
    }, null, 2),
    confidence: Math.max(0, Math.min(1, 1 - input.aiQualityScore)),
    sourceEvent: "critic_loop_proposal",
    origin: input.agentName ?? "critic"
  };
}

export async function executeCritiqueLifecycle(
  input: CritiqueLifecycleInput,
  deps: CritiqueLifecycleDeps = {}
): Promise<CritiqueLifecycleResult> {
  const targetScoreFallback = input.judge === true
    ? getCriticJudgeTargetScore()
    : getCriticHeuristicTargetScore();
  const targetScore = Math.max(0, Math.min(10, input.targetScore ?? targetScoreFallback));
  const proposalScoreThreshold = Math.max(0, Math.min(10, getCriticProposalScoreThreshold()));
  const minImprovementThreshold = Math.max(0, input.minImprovement ?? getCriticMinImprovementThreshold());
  const result = await runSelfRefineLoop(
    input.response,
    {
      topic: input.topic,
      maxIterations: input.maxIterations,
      targetScore,
      minImprovement: input.minImprovement ?? minImprovementThreshold,
      judge: input.judge,
      model: input.model,
      refineModel: input.refineModel,
      criteria: input.criteria
    }
  );

  const initialScore = result.iterations[0]?.score ?? result.finalScore;
  const qualityImprovement = Math.max(0, result.finalScore - initialScore);
  const nextAction = chooseNextAction({
    finalScore: result.finalScore,
    targetScore,
    proposalScoreThreshold,
    qualityImprovement,
    minImprovementThreshold
  });
  const critiqueResult: CritiqueLifecycleResult = {
    ...result,
    sessionId: input.sessionId,
    agentName: input.agentName,
    topic: input.topic,
    initialScore,
    aiQualityScore: Math.max(0, Math.min(1, result.finalScore / 10)),
    qualityImprovement,
    nextAction,
    recordedAt: new Date().toISOString(),
    proposalDraft: undefined
  };
  critiqueResult.proposalDraft = buildProposalDraft(critiqueResult);

  const outputsPort = new LocalOutputsAdapter({ outputsDir: resolve(getOutputsDir()) });
  await outputsPort.appendEvent("learning/critic-runs.jsonl", critiqueResult);

  if (critiqueResult.nextAction === "proposal") {
    const proposalQueue = deps.proposalQueue ?? createFileProposalQueueStore(resolve(getOutputsDir()));
    await proposalQueue.enqueue(buildProposalInput(critiqueResult));
  }

  return critiqueResult;
}
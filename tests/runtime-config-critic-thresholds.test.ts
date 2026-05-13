import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getCriticHeuristicTargetScore,
  getCriticJudgeTargetScore,
  getCriticMinImprovementThreshold,
  getCriticProposalScoreThreshold
} from "../mcp/core/config/runtime-config.js";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test("critic threshold config defaults when env is unset", () => {
  const originalJudge = process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE;
  const originalHeuristic = process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE;
  const originalProposal = process.env.SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD;
  const originalImprovement = process.env.SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD;

  try {
    delete process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE;
    delete process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE;
    delete process.env.SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD;
    delete process.env.SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD;

    assert.equal(getCriticJudgeTargetScore(), 8.5);
    assert.equal(getCriticHeuristicTargetScore(), 7);
    assert.equal(getCriticProposalScoreThreshold(), 6);
    assert.equal(getCriticMinImprovementThreshold(), 0.2);
  } finally {
    restoreEnv("SF_AI_CRITIC_JUDGE_TARGET_SCORE", originalJudge);
    restoreEnv("SF_AI_CRITIC_HEURISTIC_TARGET_SCORE", originalHeuristic);
    restoreEnv("SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD", originalProposal);
    restoreEnv("SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD", originalImprovement);
  }
});

test("critic threshold config accepts env overrides", () => {
  const originalJudge = process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE;
  const originalHeuristic = process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE;
  const originalProposal = process.env.SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD;
  const originalImprovement = process.env.SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD;

  try {
    process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE = "9.1";
    process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE = "6.8";
    process.env.SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD = "5.4";
    process.env.SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD = "0.35";

    assert.equal(getCriticJudgeTargetScore(), 9.1);
    assert.equal(getCriticHeuristicTargetScore(), 6.8);
    assert.equal(getCriticProposalScoreThreshold(), 5.4);
    assert.equal(getCriticMinImprovementThreshold(), 0.35);
  } finally {
    restoreEnv("SF_AI_CRITIC_JUDGE_TARGET_SCORE", originalJudge);
    restoreEnv("SF_AI_CRITIC_HEURISTIC_TARGET_SCORE", originalHeuristic);
    restoreEnv("SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD", originalProposal);
    restoreEnv("SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD", originalImprovement);
  }
});

test("critic threshold config ignores invalid values and uses fallback", () => {
  const originalJudge = process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE;
  const originalHeuristic = process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE;

  try {
    process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE = "not-a-number";
    process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE = "-1";

    assert.equal(getCriticJudgeTargetScore(), 8.5);
    assert.equal(getCriticHeuristicTargetScore(), 7);
  } finally {
    restoreEnv("SF_AI_CRITIC_JUDGE_TARGET_SCORE", originalJudge);
    restoreEnv("SF_AI_CRITIC_HEURISTIC_TARGET_SCORE", originalHeuristic);
  }
});
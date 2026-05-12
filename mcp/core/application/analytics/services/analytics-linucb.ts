import {
  createLinUcbState,
  exportLinUcbFeatureImportance,
  fromLinUcbSnapshot,
  rankLinUcbArms,
  toLinUcbSnapshot,
  updateLinUcbArm,
  type LinUcbSnapshot
} from "../../../learning/lin-ucb-bandit.js";

export interface LinUcbRankingInput {
  arms: Array<{ name: string; features: number[] }>;
  feedbacks?: Array<{ name: string; features: number[]; reward: number }>;
  alpha?: number;
  limit?: number;
  featureNames?: string[];
  importanceLimit?: number;
  snapshot?: LinUcbSnapshot;
}

export function buildLinUcbRankingResult(input: LinUcbRankingInput): Record<string, unknown> {
  const dimension = input.arms[0]?.features.length ?? 0;
  if (dimension <= 0) {
    throw new Error("arms.features must contain at least one value");
  }

  const state = input.snapshot
    ? fromLinUcbSnapshot(input.snapshot)
    : createLinUcbState(
        dimension,
        [...new Set(input.arms.map((a) => a.name))]
      );

  if (state.dimension !== dimension) {
    throw new Error(`snapshot dimension mismatch: snapshot=${state.dimension}, arms=${dimension}`);
  }

  for (const fb of input.feedbacks ?? []) {
    updateLinUcbArm(state, fb.name, fb.features, fb.reward);
  }

  const ranking = rankLinUcbArms(state, input.arms, input.alpha ?? 1, input.limit);
  const featureImportance = exportLinUcbFeatureImportance(state, {
    featureNames: input.featureNames,
    topK: input.importanceLimit
  });

  return {
    recommended: ranking[0] ?? null,
    ranking,
    featureImportance,
    snapshot: toLinUcbSnapshot(state)
  };
}

export async function executeLinUcbRankArms(input: LinUcbRankingInput): Promise<Record<string, unknown>> {
  return buildLinUcbRankingResult(input);
}
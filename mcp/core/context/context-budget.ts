/**
 * TASK-F6: weighted context budget allocator.
 *
 * Replaces the previous "divide maxContextChars equally across all included
 * items" strategy. Each category has an importance weight; the allocator
 * multiplies the weight by `maxContextChars`, then divides the per-category
 * budget across the items present in that category. Categories with zero
 * items contribute their share to the residual that gets re-distributed to
 * the remaining categories.
 *
 * Defaults reflect the empirical importance for chat synthesis:
 *   agents 0.30, skills 0.25, code 0.15, context 0.20, persona 0.05,
 *   framework 0.05.
 */

export type ContextCategory =
  | "agent"
  | "skill"
  | "code"
  | "context"
  | "persona"
  | "framework";

export interface CategoryWeights {
  agent: number;
  skill: number;
  code: number;
  context: number;
  persona: number;
  framework: number;
}

export const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = Object.freeze({
  agent: 0.30,
  skill: 0.25,
  code: 0.15,
  context: 0.20,
  persona: 0.05,
  framework: 0.05
});

export interface CategoryItemCounts {
  agent: number;
  skill: number;
  code: number;
  context: number;
  persona: number;
  framework: number;
}

export type CategoryBudgets = Record<ContextCategory, number | undefined>;

/**
 * Compute per-item budgets per category. Returns `undefined` for a category
 * whose item count is zero or when `maxContextChars` is unset.
 */
export function allocateCategoryBudgets(
  maxContextChars: number | undefined,
  counts: CategoryItemCounts,
  weights: CategoryWeights = DEFAULT_CATEGORY_WEIGHTS
): CategoryBudgets {
  if (!maxContextChars || maxContextChars <= 0) {
    return {
      agent: undefined,
      skill: undefined,
      code: undefined,
      context: undefined,
      persona: undefined,
      framework: undefined
    };
  }

  const presentCategories: ContextCategory[] = (Object.keys(counts) as ContextCategory[]).filter(
    (c) => counts[c] > 0
  );
  const presentWeightSum = presentCategories.reduce((sum, c) => sum + weights[c], 0);

  const budgets: CategoryBudgets = {
    agent: undefined,
    skill: undefined,
    code: undefined,
    context: undefined,
    persona: undefined,
    framework: undefined
  };

  if (presentWeightSum <= 0) return budgets;

  for (const category of presentCategories) {
    const share = weights[category] / presentWeightSum;
    const categoryBudget = Math.floor(maxContextChars * share);
    const perItem = Math.max(1, Math.floor(categoryBudget / counts[category]));
    budgets[category] = perItem;
  }

  return budgets;
}

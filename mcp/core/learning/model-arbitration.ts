/**
 * TASK-F4: model arbitration helper.
 *
 * Centralises the rules used to choose between production / shadow model
 * versions when their statistics are close. The legacy `evaluatePromotion`
 * helper in `model-registry.ts` only checks the policy thresholds; this
 * module layers explicit `recency`, `confidence`, and `coverage` axes on top
 * and emits an auditable record so promotions can be reviewed offline.
 *
 * Rules (applied in order, first match wins):
 *   1. coverage   - shadow.total must be >= minCoverage; otherwise REJECT.
 *   2. confidence - shadow.shadowWinRate - 0.5 must be >= minConfidence;
 *                   otherwise REJECT with reason="low-confidence".
 *   3. recency    - prefer the version whose stats were updated most
 *                   recently when both candidates pass coverage/confidence.
 *   4. fallback   - use the legacy signedDelta to break remaining ties.
 *
 * The returned `ArbitrationDecision` is JSON-serialisable and meant to be
 * appended to `outputs/learning/arbitration.jsonl` by the caller (typically
 * a registrar or scheduler that owns the writable filesystem path).
 */
import type { ModelEvaluationStats } from "./model-registry.js";

export type ArbitrationDecisionKind = "promote" | "hold" | "reject";

export interface ArbitrationInput {
  modelName: string;
  candidate: ModelEvaluationStats;
  /** Optional last-update timestamps in ms since epoch. */
  candidateUpdatedAt?: number;
  productionUpdatedAt?: number;
}

export interface ArbitrationPolicy {
  /** Minimum number of samples (`stats.total`) required to be considered. */
  minCoverage: number;
  /** Minimum confidence above 0.5 (so 0.05 means winRate >= 0.55). */
  minConfidence: number;
  /** When set, candidate must be at least this many ms newer than production. */
  recencyAdvantageMs: number;
}

export const DEFAULT_ARBITRATION_POLICY: ArbitrationPolicy = {
  minCoverage: 20,
  minConfidence: 0.05,
  recencyAdvantageMs: 0
};

export interface ArbitrationDecision {
  modelName: string;
  shadowVersion: string;
  kind: ArbitrationDecisionKind;
  reason: string;
  axes: {
    coverage: { value: number; threshold: number; pass: boolean };
    confidence: { value: number; threshold: number; pass: boolean };
    recency: { candidate?: number; production?: number; advantageMs: number; pass: boolean };
  };
  signedDelta: number;
  decidedAt: string;
}

export function arbitrate(
  input: ArbitrationInput,
  policy: ArbitrationPolicy = DEFAULT_ARBITRATION_POLICY
): ArbitrationDecision {
  const stats = input.candidate;
  const coverageValue = stats.total;
  const coveragePass = coverageValue >= policy.minCoverage;

  const confidenceValue = Math.max(0, stats.shadowWinRate - 0.5);
  const confidencePass = confidenceValue >= policy.minConfidence;

  const advantageMs = (input.candidateUpdatedAt ?? 0) - (input.productionUpdatedAt ?? 0);
  const recencyPass = advantageMs >= policy.recencyAdvantageMs;

  const axes = {
    coverage: { value: coverageValue, threshold: policy.minCoverage, pass: coveragePass },
    confidence: { value: confidenceValue, threshold: policy.minConfidence, pass: confidencePass },
    recency: {
      candidate: input.candidateUpdatedAt,
      production: input.productionUpdatedAt,
      advantageMs,
      pass: recencyPass
    }
  };

  let kind: ArbitrationDecisionKind;
  let reason: string;

  if (!coveragePass) {
    kind = "reject";
    reason = `coverage:${coverageValue}<${policy.minCoverage}`;
  } else if (!confidencePass) {
    kind = "reject";
    reason = `low-confidence:${confidenceValue.toFixed(3)}<${policy.minConfidence}`;
  } else if (!recencyPass) {
    kind = "hold";
    reason = `recency:advantage=${advantageMs}ms<${policy.recencyAdvantageMs}`;
  } else if (stats.signedDelta <= 0) {
    kind = "hold";
    reason = `signedDelta:${stats.signedDelta.toFixed(3)}<=0`;
  } else {
    kind = "promote";
    reason = `pass:cov=${coverageValue},conf=${confidenceValue.toFixed(3)},recency=${advantageMs}ms,delta=${stats.signedDelta.toFixed(3)}`;
  }

  return {
    modelName: input.modelName,
    shadowVersion: stats.shadowVersion,
    kind,
    reason,
    axes,
    signedDelta: stats.signedDelta,
    decidedAt: new Date().toISOString()
  };
}

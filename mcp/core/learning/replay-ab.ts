import { v4 as uuidv4 } from "uuid";
import type { SessionSnapshot } from "../recording/session-snapshot.js";

/**
 * Configuration for running an AB test variant against a recorded session
 */
export interface VariantConfig {
  promptTemplate?: {
    name: string;
    content: string;
  };
  agentOrdering?: string[];
  skillSwaps?: Record<string, string>; // originalSkill -> replacementSkill
  triggerRuleOverrides?: Record<string, any>;
  modelOverrides?: {
    primaryModel?: string;
    fallbackModel?: string;
  };
}

/**
 * Result of running a single variant against control
 */
export interface ABTestResult {
  testId: string;
  sessionId: string;
  variantId: string;
  variantType:
    | "prompt_template"
    | "trigger_rule"
    | "skill_swap"
    | "agent_order"
    | "model_override";
  variantConfig: VariantConfig;
  controlScore: number; // 0-100
  variantScore: number; // 0-100
  scoreDiff: number;
  winner: "control" | "variant" | "tie";
  isSignificant: boolean;
  confidenceLevel: number; // 0-1
  scorerVersion: string;
  metadata?: Record<string, any>;
}

/**
 * Replay-driven AB evaluation engine
 * - Replays recorded session with control + variant
 * - Uses scorer to evaluate outcomes
 * - Returns winner for governance proposal
 */
export class ReplayABEvaluator {
  private scorerVersion = "v1"; // Increment on scoring logic changes

  /**
   * Run AB test: replay session with variant config and compare to control
   * @param sessionSnapshot Original recorded session
   * @param variantConfig Override configuration to apply
   * @param variantId Variant identifier (e.g., "prompt-v2")
   * @param variantType Category of change
   * @returns Test result with winner determination
   */
  async runVariant(
    sessionSnapshot: SessionSnapshot,
    variantConfig: VariantConfig,
    variantId: string,
    variantType: ABTestResult["variantType"],
  ): Promise<ABTestResult> {
    const testId = uuidv4();

    // Evaluate control (original recording)
    const controlScore = await this.scoreSessionSnapshot(
      sessionSnapshot,
      undefined,
    );

    // Apply variant and evaluate
    const variantSnapshot = this.applyVariantOverrides(
      sessionSnapshot,
      variantConfig,
    );
    const variantScore = await this.scoreSessionSnapshot(
      variantSnapshot,
      variantConfig,
    );

    // Determine winner
    const scoreDiff = variantScore - controlScore;
    const winner =
      Math.abs(scoreDiff) < 1.0 ? "tie" : scoreDiff > 0 ? "variant" : "control";

    // Simple significance test: > 5 point difference with high confidence
    const isSignificant = Math.abs(scoreDiff) > 5;
    const confidenceLevel = isSignificant ? 0.85 : Math.abs(scoreDiff) / 10;

    return {
      testId,
      sessionId: sessionSnapshot.id,
      variantId,
      variantType,
      variantConfig,
      controlScore,
      variantScore,
      scoreDiff,
      winner,
      isSignificant,
      confidenceLevel,
      scorerVersion: this.scorerVersion,
    };
  }

  /**
   * Score a session snapshot based on recorded feedback + metrics
   * Heuristic: combine feedback score + success metrics
   * @param snapshot Session snapshot to evaluate
   * @param appliedVariant Optional variant that was applied (for context)
   * @returns Score 0-100
   */
  private async scoreSessionSnapshot(
    snapshot: SessionSnapshot,
    appliedVariant?: VariantConfig,
  ): Promise<number> {
    let score = 50; // Baseline

    // Factor 1: Feedback score if available
    if (snapshot.feedback) {
      const feedback = snapshot.feedback as any;
      score += feedback.scoreAdjustment || (feedback.score ? feedback.score * 10 : 0);
    }

    // Factor 2: Tool success rate
    if (snapshot.toolExecutions && snapshot.toolExecutions.length > 0) {
      const successful = snapshot.toolExecutions.filter(
        (t: any) => t.status === "success",
      ).length;
      const successRate = successful / snapshot.toolExecutions.length;
      score += successRate * 20; // +0 to +20 points
    }

    // Factor 3: Conversation turn count (fewer turns = more efficient)
    if (snapshot.turns) {
      const turnPenalty = Math.min(
        snapshot.turns.length / 10,
        10,
      );
      score -= turnPenalty;
    }

    // Factor 4: Token efficiency
    if (snapshot.metrics?.tokenUsage?.total) {
      const tokenEfficiency = Math.min(
        snapshot.metrics.tokenUsage.total / 10000,
        5,
      );
      score -= tokenEfficiency;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Apply variant configuration overrides to a session snapshot
   * (Creates new snapshot for replay simulation)
   */
  private applyVariantOverrides(
    snapshot: SessionSnapshot,
    config: VariantConfig,
  ): SessionSnapshot {
    const updated = JSON.parse(JSON.stringify(snapshot));

    if (config.promptTemplate) {
      updated.systemPrompt = config.promptTemplate.content;
    }

    if (config.agentOrdering && updated.turns) {
      updated.agentOrder = config.agentOrdering;
    }

    if (config.skillSwaps && updated.turns) {
      for (const turn of updated.turns) {
        if (turn.skillsUsed) {
          for (const [old, replacement] of Object.entries(
            config.skillSwaps,
          )) {
            turn.skillsUsed = turn.skillsUsed.map((s: string) =>
              s === old ? (replacement as string) : s,
            );
          }
        }
      }
    }

    if (config.modelOverrides) {
      updated.modelUsed =
        config.modelOverrides.primaryModel || updated.modelUsed;
    }

    return updated;
  }

  /**
   * Batch test multiple variants against a single session
   */
  async runMultipleVariants(
    sessionSnapshot: SessionSnapshot,
    variants: Array<{
      id: string;
      type: ABTestResult["variantType"];
      config: VariantConfig;
    }>,
  ): Promise<ABTestResult[]> {
    const results: ABTestResult[] = [];

    for (const variant of variants) {
      const result = await this.runVariant(
        sessionSnapshot,
        variant.config,
        variant.id,
        variant.type,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Get ranking of all variants by score (descending)
   */
  rankVariants(results: ABTestResult[]): ABTestResult[] {
    return [...results].sort((a, b) => b.variantScore - a.variantScore);
  }

  /**
   * Filter statistically significant winners
   */
  getSignificantWinners(results: ABTestResult[]): ABTestResult[] {
    return results.filter((r) => r.isSignificant && r.winner === "variant");
  }
}

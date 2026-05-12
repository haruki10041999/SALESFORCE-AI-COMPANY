export interface PromptMetricsInput {
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
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPromptDiagnostics(metrics: {
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

export async function executeSearchVector(args: {
  query: string;
  backend: string;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
}): Promise<Record<string, unknown>> {
  const results =
    args.backend !== "tfidf" && args.searchByKeywordAsync
      ? await args.searchByKeywordAsync(args.query)
      : args.searchByKeyword(args.query);
  return {
    query: args.query,
    count: results.length,
    backend: args.backend,
    results
  };
}

export function executeBuildPrompt(args: {
  agentName: string;
  agentContent: string;
  task: string;
  reasoningStrategy?: "auto" | "plan" | "reflect" | "tree-of-thought";
  promptVariant?: "auto" | "default" | "review" | "discussion";
  buildPrompt: (
    agent: { name: string; content: string },
    task: string,
    options?: {
      strategy?: "auto" | "plan" | "reflect" | "tree-of-thought";
      variant?: "auto" | "default" | "review" | "discussion";
    }
  ) => string;
}): { prompt: string; taskLength: number; promptLength: number; promptLineCount: number } {
  const prompt = args.buildPrompt(
    { name: args.agentName, content: args.agentContent },
    args.task,
    {
      strategy: args.reasoningStrategy ?? "auto",
      variant: args.promptVariant ?? "auto"
    }
  );
  return {
    prompt,
    taskLength: args.task.length,
    promptLength: prompt.length,
    promptLineCount: prompt.split(/\r?\n/).length
  };
}

export function executeEvaluatePromptMetrics(args: {
  prompt: string;
  skills?: string[];
  triggerKeywords?: string[];
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => PromptMetricsInput;
}): {
  metricsWithDiagnostics: PromptMetricsInput & {
    diagnostics: ReturnType<typeof buildPromptDiagnostics>;
  };
  scoreBreakdown: { sectionCoverage: number; skillCoverage: number; triggerCoverage: number };
  overallScore: number;
  rationale: string[];
} {
  const metrics = args.evaluatePromptMetrics(args.prompt, args.skills, args.triggerKeywords);
  const diagnostics = buildPromptDiagnostics(metrics);
  return {
    metricsWithDiagnostics: { ...metrics, diagnostics },
    scoreBreakdown: diagnostics.scoreBreakdown,
    overallScore: diagnostics.overallScore,
    rationale: diagnostics.rationale
  };
}

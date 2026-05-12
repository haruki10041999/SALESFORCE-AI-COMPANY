import {
  summarizeAbCausalHistory,
  type AgentAbHistoryRun
} from "../../../learning/ab-causal-analysis.js";

export interface AbHistoryAnalysisPayload {
  generatedAt: string;
  sourceRunsPath: string;
  minRuns: number;
  totalRuns: number;
  agentRanking: ReturnType<typeof summarizeAbCausalHistory>["agentRanking"];
  comparisons: ReturnType<typeof summarizeAbCausalHistory>["comparisons"];
  monthlyStrata: ReturnType<typeof summarizeAbCausalHistory>["monthlyStrata"];
}

export interface AbHistoryAnalysisView {
  totalRuns: number;
  topAgents: ReturnType<typeof summarizeAbCausalHistory>["agentRanking"];
  comparisons: ReturnType<typeof summarizeAbCausalHistory>["comparisons"];
  monthlyStrata: ReturnType<typeof summarizeAbCausalHistory>["monthlyStrata"];
}

export function parseAbHistoryRuns(content: string): AgentAbHistoryRun[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentAbHistoryRun);
}

export function buildAbHistoryAnalysis(args: {
  runs: AgentAbHistoryRun[];
  minRuns?: number;
  runsPath: string;
}): {
  payload: AbHistoryAnalysisPayload;
  view: AbHistoryAnalysisView;
} {
  const summary = summarizeAbCausalHistory(args.runs);
  const effectiveMinRuns = args.minRuns ?? 1;
  const filteredRanking = summary.agentRanking.filter((row) => row.runs >= effectiveMinRuns);
  const filteredComparisons = summary.comparisons.filter((row) => row.runs >= effectiveMinRuns);

  const payload: AbHistoryAnalysisPayload = {
    generatedAt: new Date().toISOString(),
    sourceRunsPath: args.runsPath,
    minRuns: effectiveMinRuns,
    totalRuns: summary.totalRuns,
    agentRanking: filteredRanking,
    comparisons: filteredComparisons,
    monthlyStrata: summary.monthlyStrata
  };

  return {
    payload,
    view: {
      totalRuns: summary.totalRuns,
      topAgents: filteredRanking.slice(0, 10),
      comparisons: filteredComparisons.slice(0, 10),
      monthlyStrata: summary.monthlyStrata
    }
  };
}

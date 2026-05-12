import type { AgentSynergyResult } from "../../../../tools/agent-synergy-score.js";
import type { DrillDownResult } from "../../../observability/dashboard-drill-down.js";

export function buildScoreAgentSynergyResponse(result: AgentSynergyResult): Record<string, unknown> {
  return {
    totalSessions: result.totalSessions,
    totalAgents: result.totalAgents,
    pairs: result.pairs
  };
}

export function buildDrillDownDashboardResponse(args: {
  result: DrillDownResult;
  markdown: string;
}): Array<{ type: "text"; text: string }> {
  return [
    { type: "text", text: JSON.stringify(args.result, null, 2) },
    { type: "text", text: args.markdown }
  ];
}
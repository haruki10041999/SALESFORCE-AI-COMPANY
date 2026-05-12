import type { GovernanceState } from "../core/governance/governance-state.js";
import type { RegisterGovToolDeps, ToolMetadata } from "./types.js";
import { defineRecordSkillRatingTool } from "./core-skill-rating/record-skill-rating.js";
import { defineGetSkillRatingReportTool } from "./core-skill-rating/get-skill-rating-report.js";
import { defineSearchResourcesTool } from "./core-resource-search/search-resources.js";
import { defineAutoSelectResourcesTool } from "./core-resource-search/auto-select-resources.js";
import { defineRecommendFirstStepsTool } from "./core-resource-search/recommend-first-steps.js";

export { evaluateAutoSelectionConfidence } from "../core/application/resource/services/resource-score-explainer.js";

interface RegisterResourceSearchToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, ToolMetadata>;
}

export function registerResourceSearchTools(deps: RegisterResourceSearchToolsDeps): void {
  const {
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata
  } = deps;

  defineRecordSkillRatingTool(deps);
  defineGetSkillRatingReportTool(deps);
  defineSearchResourcesTool({
    ...deps,
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata
  });
  defineAutoSelectResourcesTool({
    ...deps,
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata
  });
  defineRecommendFirstStepsTool({
    ...deps,
    loadGovernanceState,
    listMdFiles,
    scoreByQuery
  });
}

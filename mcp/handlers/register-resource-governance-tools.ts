import { resolve } from "node:path";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../core/config/runtime-config.js";
import type {
  GovernanceState,
  GovernedResourceType
} from "../core/governance/governance-state.js";
import {
  createFileProposalQueueStore,
  type ProposalQueueStore
} from "../core/resource/proposal/proposal-queue-store.js";
import type { RegisterGovToolDeps } from "./types.js";
import { defineGetResourceGovernanceTool } from "./core-governance/get-resource-governance.js";
import { defineUpdateResourceLifecycleTool } from "./core-governance/update-resource-lifecycle.js";
import { defineListResourceLifecycleTool } from "./core-governance/list-resource-lifecycle.js";
import { defineRecordResourceSignalTool } from "./core-governance/record-resource-signal.js";
import { defineAutoRefactorSuggestTool } from "./core-proposals/auto-refactor-suggest.js";
import { defineProposalFeedbackLearnTool } from "./core-proposals/proposal-feedback-learn.js";
import { defineVisualizeFeedbackLoopTool } from "./core-proposals/visualize-feedback-loop.js";
import { defineEvaluateHandlerScheduleTool } from "./core-handler-schedule/evaluate-handler-schedule.js";
import { defineReviewResourceGovernanceTool } from "./core-review/review-resource-governance.js";
import { defineSimulateGovernanceChangeTool } from "./core-review/simulate-governance-change.js";
import { defineRenderGovernanceUiTool } from "./core-review/render-governance-ui.js";

interface RegisterResourceGovernanceToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  proposalQueue?: ProposalQueueStore;
}

export function registerResourceGovernanceTools(deps: RegisterResourceGovernanceToolsDeps): void {
  const {
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent,
    proposalQueue: proposalQueueProp
  } = deps;
  const outputsDir = resolve(getOutputsDir());
  const proposalQueue = proposalQueueProp ?? createFileProposalQueueStore(outputsDir);

  // core-governance
  defineGetResourceGovernanceTool({ ...deps, loadGovernanceState, getCatalogCounts });
  defineUpdateResourceLifecycleTool({ ...deps, loadGovernanceState, saveGovernanceState });
  defineListResourceLifecycleTool({ ...deps, loadGovernanceState, listSkillsCatalog, listPresetsCatalog, listToolsCatalog });
  defineRecordResourceSignalTool({ ...deps, loadGovernanceState, saveGovernanceState });

  // core-proposals
  defineAutoRefactorSuggestTool({ ...deps, emitSystemEvent, proposalQueue });
  defineProposalFeedbackLearnTool(deps);
  defineVisualizeFeedbackLoopTool(deps);

  // core-handler-schedule
  defineEvaluateHandlerScheduleTool(deps);

  // core-review
  defineReviewResourceGovernanceTool({
    ...deps,
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent
  });
  defineSimulateGovernanceChangeTool({
    ...deps,
    loadGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore
  });
  defineRenderGovernanceUiTool({ ...deps, loadGovernanceState });
}

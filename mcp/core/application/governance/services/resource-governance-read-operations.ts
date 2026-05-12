import type { GovernanceState, GovernedResourceType } from "../../../governance/governance-state.js";
import { simulateGovernanceChange } from "../../../../tools/simulate-governance-change.js";
import {
  evaluateAllHandlerSchedules,
  validateHandlerScheduleRule,
  type HandlerScheduleRule
} from "../../../governance/handler-schedule.js";

export function executeEvaluateHandlerSchedule(args: {
  toolNames: string[];
  rules: HandlerScheduleRule[];
  at?: string;
}): unknown {
  const validationErrors: Array<{ index: number; errors: string[] }> = [];
  args.rules.forEach((rule, index) => {
    const errs = validateHandlerScheduleRule(rule);
    if (errs.length > 0) validationErrors.push({ index, errors: errs });
  });
  if (validationErrors.length > 0) {
    return { validationErrors };
  }
  const evalAt = args.at ? new Date(args.at) : new Date();
  const evaluations = evaluateAllHandlerSchedules(args.toolNames, args.rules, evalAt);
  return {
    evaluatedAt: evalAt.toISOString(),
    evaluations,
    activeCount: evaluations.filter((e) => e.active).length,
    blockedCount: evaluations.filter((e) => !e.active).length
  };
}

export async function executeGetResourceGovernance(args: {
  loadGovernanceState: () => Promise<GovernanceState>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
}): Promise<unknown> {
  const state = await args.loadGovernanceState();
  const counts = await args.getCatalogCounts(state);
  return {
    updatedAt: state.updatedAt,
    config: state.config,
    eventAutomation: state.config.eventAutomation,
    counts,
    disabled: state.disabled,
    lifecycle: state.lifecycle,
    usage: state.usage,
    bugSignals: state.bugSignals
  };
}

export async function executeSimulateGovernanceChange(args: {
  updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
  updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
  previewLimit?: number;
  loadGovernanceState: () => Promise<GovernanceState>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
}): Promise<ReturnType<typeof simulateGovernanceChange>> {
  const state = await args.loadGovernanceState();
  const counts = await args.getCatalogCounts(state);
  const catalogs: Record<GovernedResourceType, string[]> = {
    skills: await args.listSkillsCatalog(),
    tools: args.listToolsCatalog(state),
    presets: await args.listPresetsCatalog()
  };

  return simulateGovernanceChange({
    state,
    catalogs,
    counts,
    resourceScore: args.resourceScore,
    patch: {
      updateMaxCounts: args.updateMaxCounts,
      updateThresholds: args.updateThresholds
    },
    previewLimit: args.previewLimit
  });
}

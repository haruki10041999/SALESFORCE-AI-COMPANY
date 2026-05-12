import type {
  GovernanceState,
  GovernedResourceType,
  ResourceLifecycle
} from "../../../governance/governance-state.js";

type GovernanceActionType = "create" | "delete" | "disable" | "enable";

export function getEffectiveLifecycle(
  state: GovernanceState,
  resourceType: GovernedResourceType,
  name: string
): ResourceLifecycle {
  if (state.disabled[resourceType].includes(name)) {
    return "disabled";
  }
  return state.lifecycle?.[resourceType]?.[name] ?? "stable";
}

export async function executeUpdateResourceLifecycle(args: {
  resourceType: GovernedResourceType;
  name: string;
  lifecycle: ResourceLifecycle;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const state = await args.loadGovernanceState();
  state.lifecycle[args.resourceType] = state.lifecycle[args.resourceType] ?? {};

  const before = getEffectiveLifecycle(state, args.resourceType, args.name);

  if (args.lifecycle === "stable") {
    delete state.lifecycle[args.resourceType][args.name];
    state.disabled[args.resourceType] = state.disabled[args.resourceType].filter((n) => n !== args.name);
  } else if (args.lifecycle === "disabled") {
    state.lifecycle[args.resourceType][args.name] = "disabled";
    if (!state.disabled[args.resourceType].includes(args.name)) {
      state.disabled[args.resourceType].push(args.name);
    }
  } else {
    state.lifecycle[args.resourceType][args.name] = args.lifecycle;
    state.disabled[args.resourceType] = state.disabled[args.resourceType].filter((n) => n !== args.name);
  }

  await args.saveGovernanceState(state);

  const afterState = await args.loadGovernanceState();
  const after = getEffectiveLifecycle(afterState, args.resourceType, args.name);
  return {
    updated: true,
    resourceType: args.resourceType,
    name: args.name,
    before,
    lifecycle: after,
    disabled: afterState.disabled[args.resourceType].includes(args.name)
  };
}

export async function executeListResourceLifecycle(args: {
  resourceType?: GovernedResourceType;
  lifecycle?: ResourceLifecycle;
  limit?: number;
  loadGovernanceState: () => Promise<GovernanceState>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
}): Promise<Record<string, unknown>> {
  const state = await args.loadGovernanceState();
  const limitPerType = args.limit ?? 200;
  const types = args.resourceType ? [args.resourceType] : (["skills", "tools", "presets"] as const);

  const catalogs: Record<GovernedResourceType, string[]> = {
    skills: await args.listSkillsCatalog(),
    tools: args.listToolsCatalog(state),
    presets: await args.listPresetsCatalog()
  };

  const rows = types.flatMap((type) => catalogs[type].map((name) => {
    const stage = getEffectiveLifecycle(state, type, name);
    return {
      resourceType: type,
      name,
      lifecycle: stage,
      disabled: state.disabled[type].includes(name)
    };
  }))
    .filter((row) => (args.lifecycle ? row.lifecycle === args.lifecycle : true))
    .slice(0, limitPerType);

  return {
    resourceType: args.resourceType ?? "all",
    lifecycle: args.lifecycle ?? "all",
    count: rows.length,
    items: rows
  };
}

export async function executeRecordResourceSignal(args: {
  resourceType: GovernedResourceType;
  name: string;
  usageIncrement?: number;
  bugIncrement?: number;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const state = await args.loadGovernanceState();
  state.usage[args.resourceType][args.name] = (state.usage[args.resourceType][args.name] ?? 0) + (args.usageIncrement ?? 1);
  state.bugSignals[args.resourceType][args.name] = (state.bugSignals[args.resourceType][args.name] ?? 0) + (args.bugIncrement ?? 0);
  await args.saveGovernanceState(state);

  return {
    saved: true,
    resourceType: args.resourceType,
    name: args.name,
    usage: state.usage[args.resourceType][args.name],
    bugSignals: state.bugSignals[args.resourceType][args.name]
  };
}

export async function executeReviewResourceGovernance(args: {
  updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
  updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
  updateResourceLimits?: { creationsPerDay?: number; deletionsPerDay?: number };
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const state = await args.loadGovernanceState();
  if (args.updateMaxCounts) {
    state.config.maxCounts = {
      ...state.config.maxCounts,
      ...args.updateMaxCounts
    };
  }
  if (args.updateThresholds) {
    state.config.thresholds = {
      ...state.config.thresholds,
      ...args.updateThresholds
    };
  }
  if (args.updateResourceLimits) {
    state.config.resourceLimits = {
      ...state.config.resourceLimits,
      ...args.updateResourceLimits
    };
  }
  await args.saveGovernanceState(state);

  const counts = await args.getCatalogCounts(state);
  const recommendations: Array<{
    resourceType: GovernedResourceType;
    action: GovernanceActionType;
    name: string;
    reason: string;
    usage: number;
    bugSignals: number;
    score: number;
  }> = [];

  const catalogs: Record<GovernedResourceType, string[]> = {
    skills: await args.listSkillsCatalog(),
    tools: args.listToolsCatalog(state),
    presets: await args.listPresetsCatalog()
  };

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    const catalog = catalogs[resourceType];
    const max = state.config.maxCounts[resourceType];
    const overflow = Math.max(0, catalog.length - max);

    const sortedByRisk = [...catalog].sort((a, b) => {
      const scoreA = args.resourceScore(state.usage[resourceType][a] ?? 0, state.bugSignals[resourceType][a] ?? 0);
      const scoreB = args.resourceScore(state.usage[resourceType][b] ?? 0, state.bugSignals[resourceType][b] ?? 0);
      return scoreA - scoreB;
    });

    for (let index = 0; index < overflow; index++) {
      const name = sortedByRisk[index];
      const usage = state.usage[resourceType][name] ?? 0;
      const bugSignals = state.bugSignals[resourceType][name] ?? 0;
      recommendations.push({
        resourceType,
        action: resourceType === "tools" ? "disable" : "delete",
        name,
        reason: "Auto-generated text.",
        usage,
        bugSignals,
        score: args.resourceScore(usage, bugSignals)
      });
    }

    for (const name of catalog) {
      const usage = state.usage[resourceType][name] ?? 0;
      const bugSignals = state.bugSignals[resourceType][name] ?? 0;
      if (usage <= state.config.thresholds.minUsageToKeep && bugSignals >= state.config.thresholds.bugSignalToFlag) {
        recommendations.push({
          resourceType,
          action: resourceType === "tools" ? "disable" : "delete",
          name,
          reason: "Auto-generated text.",
          usage,
          bugSignals,
          score: args.resourceScore(usage, bugSignals)
        });
      }
    }
  }

  if (recommendations.length > 0) {
    await args.emitSystemEvent("governance_threshold_exceeded", {
      counts,
      thresholds: state.config.thresholds,
      recommendations: recommendations.slice(0, 20),
      recommendationCount: recommendations.length
    });
  }

  return {
    counts,
    maxCounts: state.config.maxCounts,
    thresholds: state.config.thresholds,
    resourceLimits: state.config.resourceLimits,
    recommendations
  };
}
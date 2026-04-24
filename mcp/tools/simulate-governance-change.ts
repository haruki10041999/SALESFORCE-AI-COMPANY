import type { GovernedResourceType, GovernanceState } from "../core/governance/governance-state.js";

export interface GovernanceConfigPatch {
  updateMaxCounts?: {
    skills?: number;
    tools?: number;
    presets?: number;
  };
  updateThresholds?: {
    minUsageToKeep?: number;
    bugSignalToFlag?: number;
  };
}

export interface SimulateGovernanceChangeInput {
  state: GovernanceState;
  catalogs: Record<GovernedResourceType, string[]>;
  counts: Record<GovernedResourceType, number>;
  resourceScore: (usage: number, bugs: number) => number;
  patch?: GovernanceConfigPatch;
  previewLimit?: number;
}

export interface SimulateGovernanceChangeResult {
  simulatedAt: string;
  deltas: {
    maxCounts: Record<GovernedResourceType, { before: number; after: number; diff: number }>;
    thresholds: {
      minUsageToKeep: { before: number; after: number; diff: number };
      bugSignalToFlag: { before: number; after: number; diff: number };
    };
  };
  current: {
    maxCounts: Record<GovernedResourceType, number>;
    thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
    counts: Record<GovernedResourceType, number>;
    recommendationCount: number;
  };
  proposed: {
    maxCounts: Record<GovernedResourceType, number>;
    thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
    counts: Record<GovernedResourceType, number>;
    recommendationCount: number;
  };
  impact: {
    recommendationDelta: {
      added: number;
      removed: number;
      changed: number;
    };
    byResourceType: Record<GovernedResourceType, {
      currentOverflow: number;
      projectedOverflow: number;
      added: number;
      removed: number;
      changed: number;
    }>;
    impactedResources: Array<{
      resourceType: GovernedResourceType;
      action: "delete" | "disable";
      name: string;
      usage: number;
      bugSignals: number;
      score: number;
      before: { recommended: boolean; reasons: string[] };
      after: { recommended: boolean; reasons: string[] };
    }>;
  };
}

type Recommendation = {
  resourceType: GovernedResourceType;
  action: "delete" | "disable";
  name: string;
  usage: number;
  bugSignals: number;
  score: number;
  reasons: string[];
};

function buildConfig(
  state: GovernanceState,
  patch?: GovernanceConfigPatch
): {
  maxCounts: Record<GovernedResourceType, number>;
  thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
} {
  return {
    maxCounts: {
      skills: patch?.updateMaxCounts?.skills ?? state.config.maxCounts.skills,
      tools: patch?.updateMaxCounts?.tools ?? state.config.maxCounts.tools,
      presets: patch?.updateMaxCounts?.presets ?? state.config.maxCounts.presets
    },
    thresholds: {
      minUsageToKeep: patch?.updateThresholds?.minUsageToKeep ?? state.config.thresholds.minUsageToKeep,
      bugSignalToFlag: patch?.updateThresholds?.bugSignalToFlag ?? state.config.thresholds.bugSignalToFlag
    }
  };
}

function buildRecommendations(
  state: GovernanceState,
  catalogs: Record<GovernedResourceType, string[]>,
  config: {
    maxCounts: Record<GovernedResourceType, number>;
    thresholds: { minUsageToKeep: number; bugSignalToFlag: number };
  },
  resourceScore: (usage: number, bugs: number) => number
): Map<string, Recommendation> {
  const recommendations = new Map<string, Recommendation>();

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    const catalog = catalogs[resourceType];
    const overflow = Math.max(0, catalog.length - config.maxCounts[resourceType]);

    const sortedByRisk = [...catalog].sort((a, b) => {
      const scoreA = resourceScore(state.usage[resourceType][a] ?? 0, state.bugSignals[resourceType][a] ?? 0);
      const scoreB = resourceScore(state.usage[resourceType][b] ?? 0, state.bugSignals[resourceType][b] ?? 0);
      return scoreA - scoreB;
    });

    for (let index = 0; index < overflow; index += 1) {
      const name = sortedByRisk[index];
      const key = `${resourceType}:${name}`;
      const usage = state.usage[resourceType][name] ?? 0;
      const bugSignals = state.bugSignals[resourceType][name] ?? 0;
      const existing = recommendations.get(key);
      const reasons = existing ? [...existing.reasons] : [];
      if (!reasons.includes("overflow")) {
        reasons.push("overflow");
      }
      recommendations.set(key, {
        resourceType,
        action: resourceType === "tools" ? "disable" : "delete",
        name,
        usage,
        bugSignals,
        score: resourceScore(usage, bugSignals),
        reasons
      });
    }

    for (const name of catalog) {
      const usage = state.usage[resourceType][name] ?? 0;
      const bugSignals = state.bugSignals[resourceType][name] ?? 0;
      if (usage <= config.thresholds.minUsageToKeep && bugSignals >= config.thresholds.bugSignalToFlag) {
        const key = `${resourceType}:${name}`;
        const existing = recommendations.get(key);
        const reasons = existing ? [...existing.reasons] : [];
        if (!reasons.includes("threshold")) {
          reasons.push("threshold");
        }
        recommendations.set(key, {
          resourceType,
          action: resourceType === "tools" ? "disable" : "delete",
          name,
          usage,
          bugSignals,
          score: resourceScore(usage, bugSignals),
          reasons
        });
      }
    }
  }

  return recommendations;
}

function isRecommendationChanged(before?: Recommendation, after?: Recommendation): boolean {
  if (!before || !after) return false;
  if (before.action !== after.action) return true;
  if (before.score !== after.score) return true;
  if (before.reasons.length !== after.reasons.length) return true;
  return before.reasons.some((reason) => !after.reasons.includes(reason));
}

export function simulateGovernanceChange(input: SimulateGovernanceChangeInput): SimulateGovernanceChangeResult {
  const previewLimit = Number.isFinite(input.previewLimit)
    ? Math.max(1, Math.min(200, Math.floor(input.previewLimit as number)))
    : 50;

  const currentConfig = {
    maxCounts: {
      skills: input.state.config.maxCounts.skills,
      tools: input.state.config.maxCounts.tools,
      presets: input.state.config.maxCounts.presets
    },
    thresholds: {
      minUsageToKeep: input.state.config.thresholds.minUsageToKeep,
      bugSignalToFlag: input.state.config.thresholds.bugSignalToFlag
    }
  };

  const proposedConfig = buildConfig(input.state, input.patch);
  const currentRecommendations = buildRecommendations(
    input.state,
    input.catalogs,
    currentConfig,
    input.resourceScore
  );
  const proposedRecommendations = buildRecommendations(
    input.state,
    input.catalogs,
    proposedConfig,
    input.resourceScore
  );

  const allKeys = new Set<string>([
    ...currentRecommendations.keys(),
    ...proposedRecommendations.keys()
  ]);

  const impactedResources: SimulateGovernanceChangeResult["impact"]["impactedResources"] = [];
  const byResourceType: SimulateGovernanceChangeResult["impact"]["byResourceType"] = {
    skills: {
      currentOverflow: Math.max(0, input.counts.skills - currentConfig.maxCounts.skills),
      projectedOverflow: Math.max(0, input.counts.skills - proposedConfig.maxCounts.skills),
      added: 0,
      removed: 0,
      changed: 0
    },
    tools: {
      currentOverflow: Math.max(0, input.counts.tools - currentConfig.maxCounts.tools),
      projectedOverflow: Math.max(0, input.counts.tools - proposedConfig.maxCounts.tools),
      added: 0,
      removed: 0,
      changed: 0
    },
    presets: {
      currentOverflow: Math.max(0, input.counts.presets - currentConfig.maxCounts.presets),
      projectedOverflow: Math.max(0, input.counts.presets - proposedConfig.maxCounts.presets),
      added: 0,
      removed: 0,
      changed: 0
    }
  };

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const key of allKeys) {
    const before = currentRecommendations.get(key);
    const after = proposedRecommendations.get(key);

    const beforeRecommended = Boolean(before);
    const afterRecommended = Boolean(after);
    const recommendationChanged = isRecommendationChanged(before, after);

    if (!beforeRecommended && !afterRecommended) {
      continue;
    }

    const base = after ?? before;
    if (!base) {
      continue;
    }

    if (!beforeRecommended && afterRecommended) {
      added += 1;
      byResourceType[base.resourceType].added += 1;
    } else if (beforeRecommended && !afterRecommended) {
      removed += 1;
      byResourceType[base.resourceType].removed += 1;
    } else if (recommendationChanged) {
      changed += 1;
      byResourceType[base.resourceType].changed += 1;
    } else {
      continue;
    }

    impactedResources.push({
      resourceType: base.resourceType,
      action: base.action,
      name: base.name,
      usage: base.usage,
      bugSignals: base.bugSignals,
      score: base.score,
      before: {
        recommended: beforeRecommended,
        reasons: before?.reasons ?? []
      },
      after: {
        recommended: afterRecommended,
        reasons: after?.reasons ?? []
      }
    });
  }

  impactedResources.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  return {
    simulatedAt: new Date().toISOString(),
    deltas: {
      maxCounts: {
        skills: {
          before: currentConfig.maxCounts.skills,
          after: proposedConfig.maxCounts.skills,
          diff: proposedConfig.maxCounts.skills - currentConfig.maxCounts.skills
        },
        tools: {
          before: currentConfig.maxCounts.tools,
          after: proposedConfig.maxCounts.tools,
          diff: proposedConfig.maxCounts.tools - currentConfig.maxCounts.tools
        },
        presets: {
          before: currentConfig.maxCounts.presets,
          after: proposedConfig.maxCounts.presets,
          diff: proposedConfig.maxCounts.presets - currentConfig.maxCounts.presets
        }
      },
      thresholds: {
        minUsageToKeep: {
          before: currentConfig.thresholds.minUsageToKeep,
          after: proposedConfig.thresholds.minUsageToKeep,
          diff: proposedConfig.thresholds.minUsageToKeep - currentConfig.thresholds.minUsageToKeep
        },
        bugSignalToFlag: {
          before: currentConfig.thresholds.bugSignalToFlag,
          after: proposedConfig.thresholds.bugSignalToFlag,
          diff: proposedConfig.thresholds.bugSignalToFlag - currentConfig.thresholds.bugSignalToFlag
        }
      }
    },
    current: {
      maxCounts: currentConfig.maxCounts,
      thresholds: currentConfig.thresholds,
      counts: input.counts,
      recommendationCount: currentRecommendations.size
    },
    proposed: {
      maxCounts: proposedConfig.maxCounts,
      thresholds: proposedConfig.thresholds,
      counts: input.counts,
      recommendationCount: proposedRecommendations.size
    },
    impact: {
      recommendationDelta: {
        added,
        removed,
        changed
      },
      byResourceType,
      impactedResources: impactedResources.slice(0, previewLimit)
    }
  };
}

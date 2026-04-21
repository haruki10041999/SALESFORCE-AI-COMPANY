import { existsSync, promises as fsPromises } from "fs";
import { dirname } from "path";

// ============================================================
// Governance State Types
// ============================================================

export type GovernedResourceType = "skills" | "tools" | "presets";
export type GovernanceActionType = "create" | "delete" | "disable" | "enable";

export interface GovernanceConfig {
  maxCounts: {
    skills: number;
    tools: number;
    presets: number;
  };
  thresholds: {
    minUsageToKeep: number;
    bugSignalToFlag: number;
  };
  resourceLimits: {
    creationsPerDay: number;
    deletionsPerDay: number;
  };
  eventAutomation: {
    enabled: boolean;
    protectedTools: string[];
    rules: {
      errorAggregateDetected: {
        autoDisableTool: boolean;
      };
      governanceThresholdExceeded: {
        autoDisableRecommendedTools: boolean;
        maxToolsPerRun: number;
      };
    };
  };
}

export interface GovernanceState {
  config: GovernanceConfig;
  usage: Record<GovernedResourceType, Record<string, number>>;
  bugSignals: Record<GovernedResourceType, Record<string, number>>;
  disabled: Record<GovernedResourceType, string[]>;
  updatedAt: string;
}

// ============================================================
// Pure helpers
// ============================================================

export function normalizeDisabledEntries(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))].sort();
}

export function normalizeProtectedTools(names: string[], defaultProtectedTools: string[]): string[] {
  return normalizeDisabledEntries([...defaultProtectedTools, ...names]);
}

export function buildDefaultGovernanceState(defaultProtectedTools: string[]): GovernanceState {
  return {
    config: {
      maxCounts: { skills: 30, tools: 40, presets: 20 },
      thresholds: { minUsageToKeep: 2, bugSignalToFlag: 2 },
      resourceLimits: { creationsPerDay: 5, deletionsPerDay: 3 },
      eventAutomation: {
        enabled: true,
        protectedTools: [...defaultProtectedTools],
        rules: {
          errorAggregateDetected: { autoDisableTool: true },
          governanceThresholdExceeded: { autoDisableRecommendedTools: false, maxToolsPerRun: 3 }
        }
      }
    },
    usage: { skills: {}, tools: {}, presets: {} },
    bugSignals: { skills: {}, tools: {}, presets: {} },
    disabled: { skills: [], tools: [], presets: [] },
    updatedAt: new Date().toISOString()
  };
}

// ============================================================
// File I/O helpers
// ============================================================

export async function loadGovernanceState(
  governanceFile: string,
  ensureDir: (dir: string) => Promise<void>,
  defaultProtectedTools: string[]
): Promise<GovernanceState> {
  await ensureDir(dirname(governanceFile));

  if (!existsSync(governanceFile)) {
    const initial = buildDefaultGovernanceState(defaultProtectedTools);
    await fsPromises.writeFile(governanceFile, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const raw = await fsPromises.readFile(governanceFile, "utf-8");
    const parsed = JSON.parse(raw) as GovernanceState;
    const defaults = buildDefaultGovernanceState(defaultProtectedTools);
    return {
      ...defaults,
      ...parsed,
      config: {
        ...defaults.config,
        ...parsed.config,
        maxCounts: { ...defaults.config.maxCounts, ...parsed.config?.maxCounts },
        thresholds: { ...defaults.config.thresholds, ...parsed.config?.thresholds },
        resourceLimits: { ...defaults.config.resourceLimits, ...parsed.config?.resourceLimits },
        eventAutomation: {
          ...defaults.config.eventAutomation,
          ...parsed.config?.eventAutomation,
          protectedTools: normalizeProtectedTools(
            parsed.config?.eventAutomation?.protectedTools ?? defaults.config.eventAutomation.protectedTools,
            defaultProtectedTools
          ),
          rules: {
            ...defaults.config.eventAutomation.rules,
            ...parsed.config?.eventAutomation?.rules,
            errorAggregateDetected: {
              ...defaults.config.eventAutomation.rules.errorAggregateDetected,
              ...parsed.config?.eventAutomation?.rules?.errorAggregateDetected
            },
            governanceThresholdExceeded: {
              ...defaults.config.eventAutomation.rules.governanceThresholdExceeded,
              ...parsed.config?.eventAutomation?.rules?.governanceThresholdExceeded
            }
          }
        }
      },
      usage: { ...defaults.usage, ...parsed.usage },
      bugSignals: { ...defaults.bugSignals, ...parsed.bugSignals },
      disabled: { ...defaults.disabled, ...parsed.disabled }
    };
  } catch {
    const initial = buildDefaultGovernanceState(defaultProtectedTools);
    await fsPromises.writeFile(governanceFile, JSON.stringify(initial, null, 2));
    return initial;
  }
}

export async function saveGovernanceState(
  governanceFile: string,
  state: GovernanceState
): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fsPromises.writeFile(governanceFile, JSON.stringify(state, null, 2));
}

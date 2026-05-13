import { existsSync, promises as fsPromises } from "fs";
import { dirname } from "path";
import { z } from "zod";
import { TemporaryFileManager } from "./temporary-file-manager.js";

// ============================================================
// Governance State Types
// ============================================================

export type GovernedResourceType = "skills" | "tools" | "presets";
export type GovernanceActionType = "create" | "delete" | "disable" | "enable";
export type ResourceLifecycle = "experimental" | "stable" | "deprecated" | "disabled";

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
  toolExecution: {
    retryEnabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryablePatterns: string[];
    retryableCodes: string[];
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
  approvalStages: {
    enabled: boolean;
    stages: string[];
    requireCommentOnReject: boolean;
  };
  approvalQueue: {
    timeoutHours: number;
    autoApproval: {
      enabled: boolean;
      lowRiskOnly: boolean;
    };
    escalationTargets: string[];
  };
  /**
   * SLA 閾値設定
   * - default: すべての tool に適用されるデフォルト閾値
   * - tools: tool 名をキーとするトークンマッチ、グロブ、または "prefix*" パターンで上書きを定義
   *   マッチた設定は default とマージされ、同名キーは tool-specific 設定が優先される
   */
  sla?: {
    default?: {
      maxP95Ms?: number;
      maxErrorRatePercent?: number;
    };
    tools?: Record<string, {
      maxP95Ms?: number;
      maxErrorRatePercent?: number;
    }>;
  };
}

export interface GovernanceState {
  config: GovernanceConfig;
  usage: Record<GovernedResourceType, Record<string, number>>;
  bugSignals: Record<GovernedResourceType, Record<string, number>>;
  disabled: Record<GovernedResourceType, string[]>;
  lifecycle: Record<GovernedResourceType, Record<string, ResourceLifecycle>>;
  updatedAt: string;
}

const resourceUsageSchema = z.record(z.string(), z.number());
const governedResourceMapSchema = z.object({
  skills: resourceUsageSchema.optional(),
  tools: resourceUsageSchema.optional(),
  presets: resourceUsageSchema.optional()
});
const governedDisabledSchema = z.object({
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional()
});
const resourceLifecycleSchema = z.enum(["experimental", "stable", "deprecated", "disabled"]);
const governedLifecycleMapSchema = z.object({
  skills: z.record(z.string(), resourceLifecycleSchema).optional(),
  tools: z.record(z.string(), resourceLifecycleSchema).optional(),
  presets: z.record(z.string(), resourceLifecycleSchema).optional()
});
const governanceStateFileSchema = z.object({
  config: z.object({
    maxCounts: z.object({
      skills: z.number().int().positive().optional(),
      tools: z.number().int().positive().optional(),
      presets: z.number().int().positive().optional()
    }).optional(),
    thresholds: z.object({
      minUsageToKeep: z.number().nonnegative().optional(),
      bugSignalToFlag: z.number().nonnegative().optional()
    }).optional(),
    resourceLimits: z.object({
      creationsPerDay: z.number().int().nonnegative().optional(),
      deletionsPerDay: z.number().int().nonnegative().optional()
    }).optional(),
    toolExecution: z.object({
      retryEnabled: z.boolean().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      baseDelayMs: z.number().int().nonnegative().optional(),
      maxDelayMs: z.number().int().nonnegative().optional(),
      retryablePatterns: z.array(z.string()).optional(),
      retryableCodes: z.array(z.string()).optional()
    }).optional(),
    eventAutomation: z.object({
      enabled: z.boolean().optional(),
      protectedTools: z.array(z.string()).optional(),
      rules: z.object({
        errorAggregateDetected: z.object({
          autoDisableTool: z.boolean().optional()
        }).optional(),
        governanceThresholdExceeded: z.object({
          autoDisableRecommendedTools: z.boolean().optional(),
          maxToolsPerRun: z.number().int().positive().optional()
        }).optional()
      }).optional()
    }).optional(),
    approvalStages: z.object({
      enabled: z.boolean().optional(),
      stages: z.array(z.string()).optional(),
      requireCommentOnReject: z.boolean().optional()
    }).optional(),
    approvalQueue: z.object({
      timeoutHours: z.number().int().positive().optional(),
      autoApproval: z.object({
        enabled: z.boolean().optional(),
        lowRiskOnly: z.boolean().optional()
      }).optional(),
      escalationTargets: z.array(z.string()).optional()
    }).optional(),
    sla: z.object({
      default: z.object({
        maxP95Ms: z.number().int().positive().optional(),
        maxErrorRatePercent: z.number().min(0).max(100).optional()
      }).optional(),
      tools: z.record(
        z.string(),
        z.object({
          maxP95Ms: z.number().int().positive().optional(),
          maxErrorRatePercent: z.number().min(0).max(100).optional()
        })
      ).optional()
    }).optional()
  }).optional(),
  usage: governedResourceMapSchema.optional(),
  bugSignals: governedResourceMapSchema.optional(),
  disabled: governedDisabledSchema.optional(),
  lifecycle: governedLifecycleMapSchema.optional(),
  updatedAt: z.string().optional()
});

const governanceStateLocks = new Map<string, Promise<void>>();

async function withGovernanceStateLock<T>(governanceFile: string, operation: () => Promise<T>): Promise<T> {
  const previous = governanceStateLocks.get(governanceFile) ?? Promise.resolve();
  let releaseLock: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  governanceStateLocks.set(governanceFile, previous.then(() => current));

  await previous;
  try {
    return await operation();
  } finally {
    releaseLock?.();
    if (governanceStateLocks.get(governanceFile) === current) {
      governanceStateLocks.delete(governanceFile);
    }
  }
}

async function writeGovernanceStateAtomic(governanceFile: string, state: GovernanceState): Promise<void> {
  const payload = JSON.stringify(state, null, 2);
  await TemporaryFileManager.writeAtomic(governanceFile, payload);
}

async function cleanupStaleGovernanceTempFiles(governanceFile: string): Promise<void> {
  await TemporaryFileManager.cleanupStaleTempFiles(governanceFile);
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
      maxCounts: { skills: 150, tools: 150, presets: 150 },
      thresholds: { minUsageToKeep: 2, bugSignalToFlag: 2 },
      resourceLimits: { creationsPerDay: 5, deletionsPerDay: 3 },
      toolExecution: {
        retryEnabled: true,
        maxRetries: 2,
        baseDelayMs: 150,
        maxDelayMs: 2000,
        retryablePatterns: [
          "timeout",
          "timed out",
          "econnreset",
          "econnrefused",
          "503",
          "429",
          "temporarily unavailable"
        ],
        retryableCodes: ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "429", "503", "504"]
      },
      eventAutomation: {
        enabled: true,
        protectedTools: [...defaultProtectedTools],
        rules: {
          errorAggregateDetected: { autoDisableTool: true },
          governanceThresholdExceeded: { autoDisableRecommendedTools: false, maxToolsPerRun: 3 }
        }
      },
      approvalStages: {
        enabled: true,
        stages: ["reviewer", "admin"],
        requireCommentOnReject: true
      },
      approvalQueue: {
        timeoutHours: 24,
        autoApproval: {
          enabled: true,
          lowRiskOnly: true
        },
        escalationTargets: ["PagerDuty", "Slack"]
      },
      sla: {
        default: { maxP95Ms: 200, maxErrorRatePercent: 5 },
        tools: {}
      }
    },
    usage: { skills: {}, tools: {}, presets: {} },
    bugSignals: { skills: {}, tools: {}, presets: {} },
    disabled: { skills: [], tools: [], presets: [] },
    lifecycle: { skills: {}, tools: {}, presets: {} },
    updatedAt: new Date().toISOString()
  };
}

function syncLifecycleAndDisabled(state: GovernanceState): GovernanceState {
  const normalizedDisabled = {
    skills: normalizeDisabledEntries(state.disabled.skills ?? []),
    tools: normalizeDisabledEntries(state.disabled.tools ?? []),
    presets: normalizeDisabledEntries(state.disabled.presets ?? [])
  };

  const lifecycle: GovernanceState["lifecycle"] = {
    skills: { ...(state.lifecycle.skills ?? {}) },
    tools: { ...(state.lifecycle.tools ?? {}) },
    presets: { ...(state.lifecycle.presets ?? {}) }
  };

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    for (const name of normalizedDisabled[resourceType]) {
      lifecycle[resourceType][name] = "disabled";
    }
    for (const [name, stage] of Object.entries(lifecycle[resourceType])) {
      if (stage === "disabled" && !normalizedDisabled[resourceType].includes(name)) {
        normalizedDisabled[resourceType] = normalizeDisabledEntries([...normalizedDisabled[resourceType], name]);
      }
    }
  }

  return {
    ...state,
    disabled: normalizedDisabled,
    lifecycle
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
  return withGovernanceStateLock(governanceFile, async () => {
    await ensureDir(dirname(governanceFile));
    await cleanupStaleGovernanceTempFiles(governanceFile);

    if (!existsSync(governanceFile)) {
      const initial = buildDefaultGovernanceState(defaultProtectedTools);
      await writeGovernanceStateAtomic(governanceFile, initial);
      return initial;
    }

    try {
      const raw = await fsPromises.readFile(governanceFile, "utf-8");
      const parsedJson = JSON.parse(raw) as unknown;
      const validated = governanceStateFileSchema.safeParse(parsedJson);
      if (!validated.success) {
        const initial = buildDefaultGovernanceState(defaultProtectedTools);
        await writeGovernanceStateAtomic(governanceFile, initial);
        return initial;
      }

      const parsed = validated.data;
      const defaults = buildDefaultGovernanceState(defaultProtectedTools);
      return syncLifecycleAndDisabled({
        ...defaults,
        ...parsed,
        config: {
          ...defaults.config,
          ...parsed.config,
          maxCounts: { ...defaults.config.maxCounts, ...parsed.config?.maxCounts },
          thresholds: { ...defaults.config.thresholds, ...parsed.config?.thresholds },
          resourceLimits: { ...defaults.config.resourceLimits, ...parsed.config?.resourceLimits },
          toolExecution: {
            ...defaults.config.toolExecution,
            ...parsed.config?.toolExecution,
            retryablePatterns:
              Array.isArray(parsed.config?.toolExecution?.retryablePatterns) &&
              parsed.config?.toolExecution?.retryablePatterns.length > 0
                ? [...parsed.config.toolExecution.retryablePatterns]
                : [...defaults.config.toolExecution.retryablePatterns],
            retryableCodes:
              Array.isArray(parsed.config?.toolExecution?.retryableCodes) &&
              parsed.config?.toolExecution?.retryableCodes.length > 0
                ? [...parsed.config.toolExecution.retryableCodes]
                : [...defaults.config.toolExecution.retryableCodes]
          },
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
          },
          approvalStages: {
            ...defaults.config.approvalStages,
            ...parsed.config?.approvalStages,
            stages:
              Array.isArray(parsed.config?.approvalStages?.stages) &&
              parsed.config?.approvalStages?.stages.length > 0
                ? [...new Set(parsed.config.approvalStages.stages.map((s) => s.trim()).filter((s) => s.length > 0))]
                : [...defaults.config.approvalStages.stages]
          },
          approvalQueue: {
            ...defaults.config.approvalQueue,
            ...parsed.config?.approvalQueue,
            autoApproval: {
              ...defaults.config.approvalQueue.autoApproval,
              ...(parsed.config?.approvalQueue?.autoApproval ?? {})
            },
            escalationTargets:
              Array.isArray(parsed.config?.approvalQueue?.escalationTargets) &&
              parsed.config?.approvalQueue?.escalationTargets.length > 0
                ? [...new Set(parsed.config.approvalQueue.escalationTargets.map((target) => target.trim()).filter((target) => target.length > 0))]
                : [...defaults.config.approvalQueue.escalationTargets]
          },
          sla: {
            default: {
              ...defaults.config.sla?.default,
              ...parsed.config?.sla?.default
            },
            tools: {
              ...(defaults.config.sla?.tools ?? {}),
              ...(parsed.config?.sla?.tools ?? {})
            }
          }
        },
        usage: { ...defaults.usage, ...parsed.usage },
        bugSignals: { ...defaults.bugSignals, ...parsed.bugSignals },
        disabled: { ...defaults.disabled, ...parsed.disabled },
        lifecycle: { ...defaults.lifecycle, ...parsed.lifecycle }
      });
    } catch {
      const initial = buildDefaultGovernanceState(defaultProtectedTools);
      await writeGovernanceStateAtomic(governanceFile, initial);
      return initial;
    }
  });
}

export async function saveGovernanceState(
  governanceFile: string,
  state: GovernanceState
): Promise<void> {
  await withGovernanceStateLock(governanceFile, async () => {
    const synced = syncLifecycleAndDisabled({
      ...state,
      updatedAt: new Date().toISOString()
    });
    await writeGovernanceStateAtomic(governanceFile, synced);
  });
}

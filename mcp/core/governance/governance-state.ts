import { existsSync, promises as fsPromises } from "fs";
import { basename, dirname, join } from "path";
import { z } from "zod";

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
}

export interface GovernanceState {
  config: GovernanceConfig;
  usage: Record<GovernedResourceType, Record<string, number>>;
  bugSignals: Record<GovernedResourceType, Record<string, number>>;
  disabled: Record<GovernedResourceType, string[]>;
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
    }).optional()
  }).optional(),
  usage: governedResourceMapSchema.optional(),
  bugSignals: governedResourceMapSchema.optional(),
  disabled: governedDisabledSchema.optional(),
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
  const stateDir = dirname(governanceFile);
  await fsPromises.mkdir(stateDir, { recursive: true });

  const tempFile = join(
    stateDir,
    `.${basename(governanceFile)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(state, null, 2);
  await fsPromises.writeFile(tempFile, payload, "utf-8");
  try {
    await fsPromises.rename(tempFile, governanceFile);
  } catch (err) {
    // Windows では監視中ディレクトリ内の rename が EPERM になることがある。
    // フォールバックとして直接上書きする。
    try {
      await fsPromises.unlink(tempFile);
    } catch {
      // temp ファイル削除失敗は無視
    }
    await fsPromises.writeFile(governanceFile, payload, "utf-8");
  }
}

async function cleanupStaleGovernanceTempFiles(governanceFile: string): Promise<void> {
  const stateDir = dirname(governanceFile);
  const tempPrefix = `.${basename(governanceFile)}.`;

  try {
    const entries = await fsPromises.readdir(stateDir, { withFileTypes: true });
    const staleTempFiles = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(tempPrefix) && entry.name.endsWith(".tmp"))
      .map((entry) => join(stateDir, entry.name));

    await Promise.all(
      staleTempFiles.map(async (tempFile) => {
        try {
          await fsPromises.unlink(tempFile);
        } catch {
          // 競合した削除や一時的なロックは次回ロードで再試行する。
        }
      })
    );
  } catch {
    // ディレクトリ読み取り失敗はロード処理を継続する。
  }
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
      return {
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
          }
        },
        usage: { ...defaults.usage, ...parsed.usage },
        bugSignals: { ...defaults.bugSignals, ...parsed.bugSignals },
        disabled: { ...defaults.disabled, ...parsed.disabled }
      };
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
    state.updatedAt = new Date().toISOString();
    await writeGovernanceStateAtomic(governanceFile, state);
  });
}

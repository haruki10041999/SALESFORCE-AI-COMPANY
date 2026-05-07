import type { GovernanceState } from "./governance-state.js";
import { SQLiteStateStore } from "../persistence/sqlite-store.js";
import { PostgresStateStore } from "../persistence/postgres-store.js";
import { resolveStateBackend, type StateBackend, type StateStore } from "../persistence/state-store.js";
import {
  normalizeDisabledEntries as _normalizeDisabledEntries,
  normalizeProtectedTools as _normalizeProtectedTools,
  buildDefaultGovernanceState as _buildDefaultGovernanceState,
  loadGovernanceState as _loadGovernanceState,
  saveGovernanceState as _saveGovernanceState
} from "./governance-state.js";

export interface GovernanceStateManagerDeps {
  defaultProtectedTools: string[];
  governanceFile: string;
  ensureDir: (dir: string) => Promise<void>;
  sqliteDbPath?: string;
  stateBackend?: StateBackend;
  databaseUrl?: string;
}

export interface GovernanceStateManager {
  buildDefaultGovernanceState(): GovernanceState;
  loadGovernanceState(): Promise<GovernanceState>;
  saveGovernanceState(state: GovernanceState): Promise<void>;
  normalizeDisabledEntries(names: string[]): string[];
  normalizeProtectedTools(names: string[]): string[];
}

/**
 * Factory for creating a governance state manager.
 * Encapsulates governance initialization and state management with proper dependencies.
 */
export function createGovernanceStateManager(deps: GovernanceStateManagerDeps): GovernanceStateManager {
  const {
    defaultProtectedTools,
    governanceFile,
    ensureDir,
    sqliteDbPath,
    stateBackend,
    databaseUrl
  } = deps;
  const backend = stateBackend ?? resolveStateBackend(process.env.SF_AI_STATE_BACKEND);

  let storePromise: Promise<StateStore | null> | null = null;

  function mergeStateWithDefaults(parsed: unknown): GovernanceState {
    const defaults = _buildDefaultGovernanceState(defaultProtectedTools);
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    const candidate = parsed as Partial<GovernanceState>;
    return {
      ...defaults,
      ...candidate,
      config: {
        ...defaults.config,
        ...(candidate.config ?? {}),
        maxCounts: { ...defaults.config.maxCounts, ...(candidate.config?.maxCounts ?? {}) },
        thresholds: { ...defaults.config.thresholds, ...(candidate.config?.thresholds ?? {}) },
        resourceLimits: { ...defaults.config.resourceLimits, ...(candidate.config?.resourceLimits ?? {}) },
        toolExecution: {
          ...defaults.config.toolExecution,
          ...(candidate.config?.toolExecution ?? {}),
          retryablePatterns:
            Array.isArray(candidate.config?.toolExecution?.retryablePatterns) &&
            candidate.config?.toolExecution?.retryablePatterns.length > 0
              ? [...candidate.config.toolExecution.retryablePatterns]
              : [...defaults.config.toolExecution.retryablePatterns],
          retryableCodes:
            Array.isArray(candidate.config?.toolExecution?.retryableCodes) &&
            candidate.config?.toolExecution?.retryableCodes.length > 0
              ? [...candidate.config.toolExecution.retryableCodes]
              : [...defaults.config.toolExecution.retryableCodes]
        },
        eventAutomation: {
          ...defaults.config.eventAutomation,
          ...(candidate.config?.eventAutomation ?? {}),
          protectedTools: _normalizeProtectedTools(
            candidate.config?.eventAutomation?.protectedTools ?? defaults.config.eventAutomation.protectedTools,
            defaultProtectedTools
          ),
          rules: {
            ...defaults.config.eventAutomation.rules,
            ...(candidate.config?.eventAutomation?.rules ?? {}),
            errorAggregateDetected: {
              ...defaults.config.eventAutomation.rules.errorAggregateDetected,
              ...(candidate.config?.eventAutomation?.rules?.errorAggregateDetected ?? {})
            },
            governanceThresholdExceeded: {
              ...defaults.config.eventAutomation.rules.governanceThresholdExceeded,
              ...(candidate.config?.eventAutomation?.rules?.governanceThresholdExceeded ?? {})
            }
          }
        },
        sla: {
          default: {
            ...defaults.config.sla?.default,
            ...candidate.config?.sla?.default
          },
          tools: {
            ...(defaults.config.sla?.tools ?? {}),
            ...(candidate.config?.sla?.tools ?? {})
          }
        }
      },
      usage: { ...defaults.usage, ...(candidate.usage ?? {}) },
      bugSignals: { ...defaults.bugSignals, ...(candidate.bugSignals ?? {}) },
      disabled: { ...defaults.disabled, ...(candidate.disabled ?? {}) }
    };
  }

  async function createStateStore(): Promise<StateStore | null> {
    if (backend === "postgres") {
      if (!databaseUrl || databaseUrl.trim().length === 0) {
        return null;
      }

      const postgresStore = await PostgresStateStore.open({ databaseUrl });
      return postgresStore;
    }

    if (!sqliteDbPath) {
      return null;
    }

    const sqliteStore = await SQLiteStateStore.open({ dbPath: sqliteDbPath });
    return {
      async getGovernanceStateRow() {
        return sqliteStore.getGovernanceStateRow();
      },
      async upsertGovernanceStateRow(stateJson: string, updatedAt: string) {
        sqliteStore.upsertGovernanceStateRow(stateJson, updatedAt);
      },
      async close() {
        sqliteStore.close();
      }
    };
  }

  async function withStateStore<T>(work: (store: StateStore) => Promise<T>): Promise<T | null> {
    if (!storePromise) {
      storePromise = createStateStore();
    }
    const store = await storePromise;
    if (!store) {
      return null;
    }
    return work(store);
  }

  async function loadFromSqlite(): Promise<GovernanceState> {
    const loaded = await withStateStore(async (store) => {
      const row = await store.getGovernanceStateRow();
      if (!row) {
        const legacy = await _loadGovernanceState(governanceFile, ensureDir, defaultProtectedTools);
        await store.upsertGovernanceStateRow(JSON.stringify(legacy), legacy.updatedAt);
        return legacy;
      }

      try {
        const parsed = JSON.parse(row.stateJson) as unknown;
        return mergeStateWithDefaults(parsed);
      } catch {
        const legacy = await _loadGovernanceState(governanceFile, ensureDir, defaultProtectedTools);
        await store.upsertGovernanceStateRow(JSON.stringify(legacy), legacy.updatedAt);
        return legacy;
      }
    });

    if (loaded) {
      return loaded;
    }

    return _loadGovernanceState(governanceFile, ensureDir, defaultProtectedTools);
  }

  async function saveToSqlite(state: GovernanceState): Promise<void> {
    state.updatedAt = new Date().toISOString();

    const saved = await withStateStore(async (store) => {
      await store.upsertGovernanceStateRow(JSON.stringify(state), state.updatedAt);
    });

    if (saved !== null) {
      return;
    }

    if (!sqliteDbPath && backend === "postgres") {
      await _saveGovernanceState(governanceFile, state);
      return;
    }

    await _saveGovernanceState(governanceFile, state);
  }

  return {
    buildDefaultGovernanceState(): GovernanceState {
      return _buildDefaultGovernanceState(defaultProtectedTools);
    },

    async loadGovernanceState(): Promise<GovernanceState> {
      return loadFromSqlite();
    },

    async saveGovernanceState(state: GovernanceState): Promise<void> {
      return saveToSqlite(state);
    },

    normalizeDisabledEntries(names: string[]): string[] {
      return _normalizeDisabledEntries(names);
    },

    normalizeProtectedTools(names: string[]): string[] {
      return _normalizeProtectedTools(names, defaultProtectedTools);
    }
  };
}

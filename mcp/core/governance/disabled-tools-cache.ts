import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { Client } from "pg";
import type { Logger } from "../logging/logger.js";
import type { StateBackend } from "../persistence/state-store.js";

interface DisabledToolsCacheState {
  disabled: {
    tools?: string[];
  };
}

interface CreateDisabledToolsCacheDeps {
  governanceFilePath: string;
  logger: Logger;
  loadGovernanceState: () => Promise<DisabledToolsCacheState>;
  normalizeResourceName: (name: string) => string;
  stateBackend?: StateBackend;
  databaseUrl?: string;
  cacheMaxAgeMs?: number;
  refreshIntervalMs?: number;
}

export function createDisabledToolsCacheManager(deps: CreateDisabledToolsCacheDeps): {
  isToolDisabled: (toolName: string) => boolean;
  refresh: (reason?: string) => Promise<void>;
  startSync: () => void;
  resetCache: () => void;
} {
  const cacheMaxAgeMs = deps.cacheMaxAgeMs ?? 5 * 60 * 1000;
  const refreshIntervalMs = deps.refreshIntervalMs ?? 15 * 60 * 1000;

  let cachedDisabledTools: Set<string> = new Set();
  let disabledToolsCacheLastRefreshAt = 0;
  let refreshInFlight: Promise<void> | null = null;
  let governanceWatcher: FSWatcher | null = null;
  let refreshInterval: NodeJS.Timeout | null = null;
  let pgListener: Client | null = null;

  function startRefresh(reason: string): void {
    if (!refreshInFlight) {
      refreshInFlight = refresh(reason)
        .catch((error) => {
          deps.logger.warn(`Disabled tools cache refresh failed (${reason})`, error);
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }
  }

  function maybeRefresh(reason: string): void {
    const isStale = Date.now() - disabledToolsCacheLastRefreshAt > cacheMaxAgeMs;
    if (isStale) {
      startRefresh(reason);
    }
  }

  async function refresh(_reason = "manual"): Promise<void> {
    try {
      const state = await deps.loadGovernanceState();
      cachedDisabledTools = new Set((state.disabled.tools ?? []).map((name) => deps.normalizeResourceName(name)));
      disabledToolsCacheLastRefreshAt = Date.now();
    } catch {
      cachedDisabledTools = new Set();
      disabledToolsCacheLastRefreshAt = Date.now();
    }
  }

  function startSync(): void {
    if (!refreshInterval) {
      refreshInterval = setInterval(() => {
        startRefresh("interval");
      }, refreshIntervalMs);
      refreshInterval.unref?.();
    }

    // Multi-instance invalidation path: LISTEN/NOTIFY on Postgres
    if (deps.stateBackend === "postgres" && deps.databaseUrl && !pgListener) {
      const listener = new Client({ connectionString: deps.databaseUrl });
      void listener.connect()
        .then(async () => {
          pgListener = listener;
          listener.on("notification", (msg) => {
            if (msg.channel === "governance_state_updated") {
              startRefresh("pg-notify");
            }
          });
          listener.on("error", (error) => {
            deps.logger.warn("Governance pg LISTEN error", error);
          });
          await listener.query("LISTEN governance_state_updated");
        })
        .catch((error) => {
          deps.logger.warn("Failed to start governance pg LISTEN", error);
        });
    }

    if (!governanceWatcher) {
      const watchedDir = dirname(deps.governanceFilePath);
      const watchedFile = basename(deps.governanceFilePath);
      governanceWatcher = watch(watchedDir, (_eventType, fileName) => {
        if (!fileName || fileName.toString() !== watchedFile) {
          return;
        }
        startRefresh("fs-watch");
      });
      governanceWatcher.on("error", (error) => {
        deps.logger.warn("Governance file watcher error", error);
      });
      governanceWatcher.unref?.();
    }
  }

  function isToolDisabled(toolName: string): boolean {
    maybeRefresh("on-check");
    return cachedDisabledTools.has(toolName);
  }

  function resetCache(): void {
    cachedDisabledTools = new Set();
    disabledToolsCacheLastRefreshAt = Date.now();
  }

  return {
    isToolDisabled,
    refresh,
    startSync,
    resetCache
  };
}

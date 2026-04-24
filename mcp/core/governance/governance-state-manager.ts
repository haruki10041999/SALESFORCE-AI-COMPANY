import type { GovernanceState } from "./governance-state.js";
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
  const { defaultProtectedTools, governanceFile, ensureDir } = deps;

  return {
    buildDefaultGovernanceState(): GovernanceState {
      return _buildDefaultGovernanceState(defaultProtectedTools);
    },

    async loadGovernanceState(): Promise<GovernanceState> {
      return _loadGovernanceState(governanceFile, ensureDir, defaultProtectedTools);
    },

    async saveGovernanceState(state: GovernanceState): Promise<void> {
      return _saveGovernanceState(governanceFile, state);
    },

    normalizeDisabledEntries(names: string[]): string[] {
      return _normalizeDisabledEntries(names);
    },

    normalizeProtectedTools(names: string[]): string[] {
      return _normalizeProtectedTools(names, defaultProtectedTools);
    }
  };
}

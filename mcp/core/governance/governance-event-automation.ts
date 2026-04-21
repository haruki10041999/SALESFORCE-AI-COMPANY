import type { GovernanceState } from "./governance-state.js";

interface EventAutomationDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  normalizeResourceName: (name: string) => string;
  normalizeDisabledEntries: (names: string[]) => string[];
  normalizeProtectedTools: (names: string[]) => string[];
  refreshDisabledToolsCache: () => Promise<void>;
  getDefaultEventAutomationConfig: () => GovernanceState["config"]["eventAutomation"];
  summarizeError: (error: unknown, maxLen?: number) => string;
}

export function createGovernanceEventAutomationManager(deps: EventAutomationDeps) {
  const {
    loadGovernanceState,
    saveGovernanceState,
    normalizeResourceName,
    normalizeDisabledEntries,
    normalizeProtectedTools,
    refreshDisabledToolsCache,
    getDefaultEventAutomationConfig,
    summarizeError
  } = deps;

  async function setToolDisabledState(toolName: string, disabled: boolean): Promise<{ changed: boolean; disabledTools: string[] }> {
    const state = await loadGovernanceState();
    const normalizedName = normalizeResourceName(toolName);
    const current = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));

    if (disabled) {
      current.add(normalizedName);
    } else {
      current.delete(normalizedName);
    }

    const nextDisabledTools = normalizeDisabledEntries([...current]);
    const changed = JSON.stringify(nextDisabledTools) !== JSON.stringify(normalizeDisabledEntries(state.disabled.tools ?? []));
    if (changed) {
      state.disabled.tools = nextDisabledTools;
      state.config.eventAutomation.protectedTools = normalizeProtectedTools(state.config.eventAutomation.protectedTools ?? []);
      await saveGovernanceState(state);
      await refreshDisabledToolsCache();
    }

    return {
      changed,
      disabledTools: nextDisabledTools
    };
  }

  async function applyEventAutomation(event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const defaults = getDefaultEventAutomationConfig();
      const state = await loadGovernanceState();
      const automation = {
        ...defaults,
        ...state.config.eventAutomation,
        protectedTools: normalizeProtectedTools(state.config.eventAutomation?.protectedTools ?? defaults.protectedTools),
        rules: {
          ...defaults.rules,
          ...state.config.eventAutomation?.rules,
          errorAggregateDetected: {
            ...defaults.rules.errorAggregateDetected,
            ...state.config.eventAutomation?.rules?.errorAggregateDetected
          },
          governanceThresholdExceeded: {
            ...defaults.rules.governanceThresholdExceeded,
            ...state.config.eventAutomation?.rules?.governanceThresholdExceeded
          }
        }
      };

      if (!automation.enabled) {
        return;
      }

      const protectedTools = new Set((automation.protectedTools ?? []).map((name) => normalizeResourceName(name)));

      if (event === "error_aggregate_detected" && automation.rules.errorAggregateDetected.autoDisableTool) {
        const rawToolName = typeof payload.toolName === "string" ? payload.toolName : "";
        const toolName = normalizeResourceName(rawToolName);
        if (!toolName) {
          payload.automation = { action: "skip", reason: "missing-tool-name" };
          return;
        }
        if (protectedTools.has(toolName)) {
          payload.automation = { action: "skip", reason: "protected-tool", toolName };
          return;
        }

        const disabledSet = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));
        if (disabledSet.has(toolName)) {
          payload.automation = { action: "skip", reason: "already-disabled", toolName };
          return;
        }

        const result = await setToolDisabledState(toolName, true);
        payload.automation = {
          action: result.changed ? "disable-tool" : "skip",
          toolName,
          changed: result.changed,
          disabledTools: result.disabledTools
        };
        return;
      }

      if (event === "governance_threshold_exceeded" && automation.rules.governanceThresholdExceeded.autoDisableRecommendedTools) {
        const recommendations = Array.isArray(payload.recommendations)
          ? payload.recommendations as Array<{ resourceType?: string; action?: string; name?: string }>
          : [];
        const limit = Math.max(0, automation.rules.governanceThresholdExceeded.maxToolsPerRun ?? 0);
        const toolRecommendations = recommendations
          .filter((item) => item.resourceType === "tools" && item.action === "disable" && typeof item.name === "string")
          .slice(0, limit);

        const applied: string[] = [];
        const skipped: Array<{ toolName: string; reason: string }> = [];

        for (const item of toolRecommendations) {
          const toolName = normalizeResourceName(item.name ?? "");
          if (!toolName) {
            continue;
          }
          if (protectedTools.has(toolName)) {
            skipped.push({ toolName, reason: "protected-tool" });
            continue;
          }
          const result = await setToolDisabledState(toolName, true);
          if (result.changed) {
            applied.push(toolName);
          } else {
            skipped.push({ toolName, reason: "already-disabled" });
          }
        }

        payload.automation = {
          action: "disable-recommended-tools",
          applied,
          skipped,
          limit
        };
      }
    } catch (error) {
      payload.automation = {
        action: "error",
        message: summarizeError(error, 300)
      };
    }
  }

  return {
    setToolDisabledState,
    applyEventAutomation
  };
}

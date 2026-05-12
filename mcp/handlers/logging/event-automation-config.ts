import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";

export interface DefineEventAutomationConfigToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  buildDefaultGovernanceState: () => GovernanceState;
  normalizeProtectedTools: (names: string[]) => string[];
}

export function defineEventAutomationConfigTools(deps: DefineEventAutomationConfigToolsDeps): void {
  const {
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools
  } = deps;

  govTool(
    "get_event_automation_config",
    {
      title: "イベント自動化設定取得",
      description: "イベント自動化設定を取得します。",
      inputSchema: {}
    },
    async () => {
      const state = await loadGovernanceState();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...state.config.eventAutomation,
                retryStrategy: state.config.toolExecution
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "update_event_automation_config",
    {
      title: "イベント自動化設定更新",
      description: "イベント自動化設定を更新します。",
      inputSchema: {
        enabled: z.boolean().optional(),
        protectedTools: z.array(z.string()).optional(),
        errorAggregateDetected: z.object({
          autoDisableTool: z.boolean().optional()
        }).optional(),
        governanceThresholdExceeded: z.object({
          autoDisableRecommendedTools: z.boolean().optional(),
          maxToolsPerRun: z.number().int().min(0).max(20).optional()
        }).optional(),
        retryStrategy: z.object({
          retryEnabled: z.boolean().optional(),
          maxRetries: z.number().int().min(0).max(5).optional(),
          baseDelayMs: z.number().int().min(10).max(10000).optional(),
          maxDelayMs: z.number().int().min(10).max(30000).optional(),
          retryablePatterns: z.array(z.string()).max(30).optional(),
          retryableCodes: z.array(z.string()).max(30).optional()
        }).optional()
      }
    },
    async ({ enabled, protectedTools, errorAggregateDetected, governanceThresholdExceeded, retryStrategy }: {
      enabled?: boolean;
      protectedTools?: string[];
      errorAggregateDetected?: { autoDisableTool?: boolean };
      governanceThresholdExceeded?: { autoDisableRecommendedTools?: boolean; maxToolsPerRun?: number };
      retryStrategy?: {
        retryEnabled?: boolean;
        maxRetries?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        retryablePatterns?: string[];
        retryableCodes?: string[];
      };
    }) => {
      const defaults = buildDefaultGovernanceState().config.eventAutomation;
      const retryDefaults = buildDefaultGovernanceState().config.toolExecution;
      const state = await loadGovernanceState();
      state.config.eventAutomation = {
        ...defaults,
        ...state.config.eventAutomation,
        enabled: enabled ?? state.config.eventAutomation?.enabled ?? defaults.enabled,
        protectedTools: normalizeProtectedTools(
          protectedTools ?? state.config.eventAutomation?.protectedTools ?? defaults.protectedTools
        ),
        rules: {
          ...defaults.rules,
          ...state.config.eventAutomation?.rules,
          errorAggregateDetected: {
            ...defaults.rules.errorAggregateDetected,
            ...state.config.eventAutomation?.rules?.errorAggregateDetected,
            ...errorAggregateDetected
          },
          governanceThresholdExceeded: {
            ...defaults.rules.governanceThresholdExceeded,
            ...state.config.eventAutomation?.rules?.governanceThresholdExceeded,
            ...governanceThresholdExceeded
          }
        }
      };
      state.config.toolExecution = {
        ...retryDefaults,
        ...state.config.toolExecution,
        ...retryStrategy,
        retryablePatterns:
          retryStrategy?.retryablePatterns ??
          state.config.toolExecution?.retryablePatterns ??
          retryDefaults.retryablePatterns,
        retryableCodes:
          retryStrategy?.retryableCodes ??
          state.config.toolExecution?.retryableCodes ??
          retryDefaults.retryableCodes
      };
      await saveGovernanceState(state);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                updated: true,
                eventAutomation: state.config.eventAutomation,
                retryStrategy: state.config.toolExecution
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

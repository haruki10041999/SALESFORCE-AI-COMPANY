import { z } from "zod";
import {
  executeReviewResourceGovernance
} from "../../core/application/governance/services/resource-governance-state-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType } from "../../core/governance/governance-state.js";

export interface DefineReviewResourceGovernanceDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function defineReviewResourceGovernanceTool(deps: DefineReviewResourceGovernanceDeps): void {
  const {
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent
  } = deps;

  govTool(
    "review_resource_governance",
    {
      title: "リソースガバナンスレビュー",
      description: "リソースガバナンスをレビューし提案を返します。",
      inputSchema: z.object({
        updateMaxCounts: z.object({
          skills: z.number().int().min(1).max(200).optional(),
          tools: z.number().int().min(1).max(200).optional(),
          presets: z.number().int().min(1).max(200).optional()
        }).optional(),
        updateThresholds: z.object({
          minUsageToKeep: z.number().int().min(0).max(100).optional(),
          bugSignalToFlag: z.number().int().min(0).max(100).optional()
        }).optional(),
        updateResourceLimits: z.object({
          creationsPerDay: z.number().int().min(1).max(100).optional(),
          deletionsPerDay: z.number().int().min(1).max(100).optional()
        }).optional()
      })
    },
    async ({ updateMaxCounts, updateThresholds, updateResourceLimits }: {
      updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
      updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
      updateResourceLimits?: { creationsPerDay?: number; deletionsPerDay?: number };
    }) => {
      const payload = await executeReviewResourceGovernance({
        updateMaxCounts,
        updateThresholds,
        updateResourceLimits,
        loadGovernanceState,
        saveGovernanceState,
        getCatalogCounts,
        listSkillsCatalog,
        listPresetsCatalog,
        listToolsCatalog,
        resourceScore,
        emitSystemEvent
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );
}

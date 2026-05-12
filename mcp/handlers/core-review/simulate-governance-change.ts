import { z } from "zod";
import {
  executeSimulateGovernanceChange
} from "../../core/application/governance/services/resource-governance-read-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType } from "../../core/governance/governance-state.js";

export interface DefineSimulateGovernanceChangeDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
}

export function defineSimulateGovernanceChangeTool(deps: DefineSimulateGovernanceChangeDeps): void {
  const {
    govTool,
    loadGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore
  } = deps;

  govTool(
    "simulate_governance_change",
    {
      title: "ガバナンス変更シミュレーション",
      description: "ガバナンス設定変更を dry-run 評価し、影響リソースと現状との差分を返します。",
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
        previewLimit: z.number().int().min(1).max(200).optional()
      })
    },
    async ({
      updateMaxCounts,
      updateThresholds,
      previewLimit
    }: {
      updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
      updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
      previewLimit?: number;
    }) => {
      const simulated = await executeSimulateGovernanceChange({
        updateMaxCounts,
        updateThresholds,
        previewLimit,
        loadGovernanceState,
        getCatalogCounts,
        listSkillsCatalog,
        listPresetsCatalog,
        listToolsCatalog,
        resourceScore
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simulated, null, 2)
          }
        ]
      };
    }
  );
}

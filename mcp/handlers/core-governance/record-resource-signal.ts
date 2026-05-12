import { z } from "zod";
import {
  executeRecordResourceSignal
} from "../../core/application/governance/services/resource-governance-state-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType } from "../../core/governance/governance-state.js";

export interface DefineRecordResourceSignalDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
}

export function defineRecordResourceSignalTool(deps: DefineRecordResourceSignalDeps): void {
  const { govTool, loadGovernanceState, saveGovernanceState } = deps;

  govTool(
    "record_resource_signal",
    {
      title: "リソースシグナル記録",
      description: "リソース利用シグナルを記録します。",
      inputSchema: z.object({
        resourceType: z.enum(["skills", "tools", "presets"]),
        name: z.string(),
        usageIncrement: z.number().int().min(0).max(100).optional(),
        bugIncrement: z.number().int().min(0).max(100).optional()
      })
    },
    async ({ resourceType, name, usageIncrement, bugIncrement }: {
      resourceType: GovernedResourceType;
      name: string;
      usageIncrement?: number;
      bugIncrement?: number;
    }) => {
      const payload = await executeRecordResourceSignal({
        resourceType,
        name,
        usageIncrement,
        bugIncrement,
        loadGovernanceState,
        saveGovernanceState
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

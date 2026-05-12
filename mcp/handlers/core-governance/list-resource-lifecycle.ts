import { z } from "zod";
import {
  executeListResourceLifecycle
} from "../../core/application/governance/services/resource-governance-state-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType, ResourceLifecycle } from "../../core/governance/governance-state.js";

export interface DefineListResourceLifecycleDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
}

export function defineListResourceLifecycleTool(deps: DefineListResourceLifecycleDeps): void {
  const { govTool, loadGovernanceState, listSkillsCatalog, listPresetsCatalog, listToolsCatalog } = deps;

  govTool(
    "list_resource_lifecycle",
    {
      title: "リソースライフサイクル一覧",
      description: "catalog からリソース lifecycle 一覧を返します。",
      inputSchema: z.object({
        resourceType: z.enum(["skills", "tools", "presets"]).optional(),
        lifecycle: z.enum(["experimental", "stable", "deprecated", "disabled"]).optional(),
        limit: z.number().int().min(1).max(500).optional()
      })
    },
    async ({ resourceType, lifecycle, limit }: {
      resourceType?: GovernedResourceType;
      lifecycle?: ResourceLifecycle;
      limit?: number;
    }) => {
      const payload = await executeListResourceLifecycle({
        resourceType,
        lifecycle,
        limit,
        loadGovernanceState,
        listSkillsCatalog,
        listPresetsCatalog,
        listToolsCatalog
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

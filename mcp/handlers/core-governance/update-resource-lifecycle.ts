import { z } from "zod";
import {
  executeUpdateResourceLifecycle
} from "../../core/application/governance/services/resource-governance-state-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType, ResourceLifecycle } from "../../core/governance/governance-state.js";

export interface DefineUpdateResourceLifecycleDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
}

export function defineUpdateResourceLifecycleTool(deps: DefineUpdateResourceLifecycleDeps): void {
  const { govTool, loadGovernanceState, saveGovernanceState } = deps;

  govTool(
    "update_resource_lifecycle",
    {
      title: "リソースライフサイクル更新",
      description: "リソースの lifecycle を更新します。disabled は disabled 配列にも同期されます。",
      inputSchema: z.object({
        resourceType: z.enum(["skills", "tools", "presets"]),
        name: z.string(),
        lifecycle: z.enum(["experimental", "stable", "deprecated", "disabled"])
      })
    },
    async ({ resourceType, name, lifecycle }: {
      resourceType: GovernedResourceType;
      name: string;
      lifecycle: ResourceLifecycle;
    }) => {
      const payload = await executeUpdateResourceLifecycle({
        resourceType,
        name,
        lifecycle,
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

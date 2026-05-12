import { z } from "zod";
import {
  executeGetResourceGovernance
} from "../../core/application/governance/services/resource-governance-read-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState, GovernedResourceType } from "../../core/governance/governance-state.js";

export interface DefineGetResourceGovernanceDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
}

export function defineGetResourceGovernanceTool(deps: DefineGetResourceGovernanceDeps): void {
  const { govTool, loadGovernanceState, getCatalogCounts } = deps;

  govTool(
    "get_resource_governance",
    {
      title: "リソースガバナンス取得",
      description: "リソースガバナンスの現在状態を取得します。",
      inputSchema: z.object({})
    },
    async () => {
      const payload = await executeGetResourceGovernance({
        loadGovernanceState,
        getCatalogCounts
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

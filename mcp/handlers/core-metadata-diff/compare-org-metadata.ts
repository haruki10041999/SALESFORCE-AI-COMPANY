import { z } from "zod";
import { compareOrgMetadata } from "../../tools/org-metadata-diff.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineCompareOrgMetadataDeps extends RegisterGovToolDeps {}

export function defineCompareOrgMetadataTool(deps: DefineCompareOrgMetadataDeps): void {
  const { govTool } = deps;

  govTool(
    "compare_org_metadata",
    {
      title: "複数Orgメタデータ差分比較",
      description: "基準OrgのインベントリJSONを基準に、複数Orgのメタデータ差分を比較します。",
      inputSchema: {
        baselineOrg: z.string(),
        baselineInventoryFile: z.string(),
        compareOrgs: z.array(
          z.object({
            org: z.string(),
            inventoryFile: z.string()
          })
        ).min(1),
        sampleLimit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({
      baselineOrg,
      baselineInventoryFile,
      compareOrgs,
      sampleLimit
    }: {
      baselineOrg: string;
      baselineInventoryFile: string;
      compareOrgs: Array<{ org: string; inventoryFile: string }>;
      sampleLimit?: number;
    }) => {
      const result = compareOrgMetadata({
        baselineOrg,
        baselineInventoryFile,
        compareOrgs,
        sampleLimit
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

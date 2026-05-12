import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { listOrgs, summariseCatalog, type OrgListFilter } from "../../core/org/org-catalog.js";
import { loadOrgCatalog } from "../../core/org/org-catalog-store.js";

const ORG_TYPE = z.enum(["production", "sandbox", "scratch", "developer"]);

export function defineListOrgsTool(govTool: GovTool, catalogFile: string): void {
  govTool(
    "list_orgs",
    {
      title: "Org カタログ一覧",
      description: "Org をフィルタ条件に基づいて一覧します。",
      inputSchema: {
        type: ORG_TYPE.optional(),
        tag: z.string().optional(),
        query: z.string().optional()
      }
    },
    async (filter: OrgListFilter) => {
      const catalog = await loadOrgCatalog(catalogFile);
      const orgs = listOrgs(catalog, filter);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: orgs.length,
            orgs,
            summary: summariseCatalog(catalog)
          }, null, 2)
        }]
      };
    }
  );
}

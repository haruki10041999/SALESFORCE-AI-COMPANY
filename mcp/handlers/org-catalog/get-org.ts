import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { getOrg } from "../../core/org/org-catalog.js";
import { loadOrgCatalog } from "../../core/org/org-catalog-store.js";

export function defineGetOrgTool(govTool: GovTool, catalogFile: string): void {
  govTool(
    "get_org",
    {
      title: "Org 詳細取得",
      description: "alias から Org エントリを取得します。",
      inputSchema: { alias: z.string().min(1).max(64) }
    },
    async ({ alias }: { alias: string }) => {
      const catalog = await loadOrgCatalog(catalogFile);
      const entry = getOrg(catalog, alias);
      return {
        content: [{ type: "text", text: JSON.stringify({ found: entry !== null, entry }, null, 2) }]
      };
    }
  );
}

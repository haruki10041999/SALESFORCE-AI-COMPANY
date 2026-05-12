import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { removeOrg } from "../../core/org/org-catalog.js";
import { loadOrgCatalog, saveOrgCatalog } from "../../core/org/org-catalog-store.js";

export function defineRemoveOrgTool(govTool: GovTool, catalogFile: string): void {
  govTool(
    "remove_org",
    {
      title: "Org カタログ削除",
      description: "指定 alias の Org をカタログから削除します。",
      inputSchema: { alias: z.string().min(1).max(64) }
    },
    async ({ alias }: { alias: string }) => {
      const catalog = await loadOrgCatalog(catalogFile);
      const result = removeOrg(catalog, alias);
      if (result.removed) {
        await saveOrgCatalog(catalogFile, result.catalog);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ removed: result.removed, alias, catalogFile }, null, 2) }]
      };
    }
  );
}

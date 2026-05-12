import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { upsertOrg, type OrgType } from "../../core/org/org-catalog.js";
import { loadOrgCatalog, saveOrgCatalog } from "../../core/org/org-catalog-store.js";

const ORG_TYPE = z.enum(["production", "sandbox", "scratch", "developer"]);

export function defineRegisterOrgTool(govTool: GovTool, catalogFile: string): void {
  govTool(
    "register_org",
    {
      title: "Org カタログ登録",
      description: "Salesforce Org メタデータをカタログに追加または更新します。",
      inputSchema: {
        alias: z.string().min(1).max(64),
        instanceUrl: z.string().url(),
        type: ORG_TYPE,
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    async (input: {
      alias: string;
      instanceUrl: string;
      type: OrgType;
      tags?: string[];
      notes?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const catalog = await loadOrgCatalog(catalogFile);
      const result = upsertOrg(catalog, input);
      if (result.errors.length === 0) {
        await saveOrgCatalog(catalogFile, result.catalog);
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            created: result.created,
            entry: result.entry,
            errors: result.errors,
            catalogFile
          }, null, 2)
        }]
      };
    }
  );
}

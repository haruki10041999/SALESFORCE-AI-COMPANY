import { z } from "zod";
import { join, resolve } from "node:path";
import {
  upsertOrg,
  removeOrg,
  getOrg,
  listOrgs,
  summariseCatalog,
  type OrgType,
  type OrgListFilter
} from "../core/org/org-catalog.js";
import { loadOrgCatalog, saveOrgCatalog } from "../core/org/org-catalog-store.js";
import type { GovTool } from "../tool-types.js";

export interface RegisterOrgCatalogToolsDeps {
  govTool: GovTool;
  outputsDir?: string;
}

const ORG_TYPE = z.enum(["production", "sandbox", "scratch", "developer"]);

export function registerOrgCatalogTools(deps: RegisterOrgCatalogToolsDeps): void {
  const { govTool } = deps;
  const outputsDir = deps.outputsDir ?? (process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs"));
  const catalogFile = join(outputsDir, "orgs", "catalog.json");

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
        content: [{ type: "text", text: JSON.stringify({
          created: result.created,
          entry: result.entry,
          errors: result.errors,
          catalogFile
        }, null, 2) }]
      };
    }
  );

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
      if (result.removed) await saveOrgCatalog(catalogFile, result.catalog);
      return {
        content: [{ type: "text", text: JSON.stringify({ removed: result.removed, alias, catalogFile }, null, 2) }]
      };
    }
  );

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
        content: [{ type: "text", text: JSON.stringify({
          total: orgs.length,
          orgs,
          summary: summariseCatalog(catalog)
        }, null, 2) }]
      };
    }
  );

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

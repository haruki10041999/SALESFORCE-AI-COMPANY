import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { removeOrg, type OrgCatalog } from "../../core/org/org-catalog.js";
import { loadOrgCatalog, saveOrgCatalog } from "../../core/org/org-catalog-store.js";
import { defineSaga } from "../../core/ports/saga.js";
import { runSaga } from "../../infrastructure/workflow/saga-runner.js";

export function defineRemoveOrgTool(govTool: GovTool, catalogFile: string): void {
  govTool(
    "remove_org",
    {
      title: "Org カタログ削除",
      description: "指定 alias の Org をカタログから削除します。",
      inputSchema: { alias: z.string().min(1).max(64) }
    },
    async ({ alias }: { alias: string }) => {
      let result: { removed: boolean } = { removed: false };
      let previousCatalog: OrgCatalog | undefined;

      const saga = defineSaga({
        name: "remove_org",
        steps: [
          {
            name: "remove-from-org-catalog",
            do: async () => {
              const catalog = await loadOrgCatalog(catalogFile);
              previousCatalog = JSON.parse(JSON.stringify(catalog)) as OrgCatalog;
              const next = removeOrg(catalog, alias);
              result = { removed: next.removed };
              if (next.removed) {
                await saveOrgCatalog(catalogFile, next.catalog);
              }
            },
            undo: async () => {
              if (!result.removed || !previousCatalog) {
                return;
              }
              await saveOrgCatalog(catalogFile, previousCatalog);
            }
          }
        ]
      });

      const sagaResult = await runSaga({
        saga,
        context: {}
      });

      const payload: Record<string, unknown> = {
        removed: result.removed,
        alias,
        catalogFile,
        saga: {
          status: sagaResult.status,
          completedSteps: sagaResult.completedSteps,
          compensatedSteps: sagaResult.compensatedSteps,
          compensationFailures: sagaResult.compensationFailures.map((failure) => ({
            step: failure.step,
            error: String(failure.error)
          }))
        }
      };

      if (sagaResult.failure) {
        payload.error = {
          step: sagaResult.failure.step,
          message: String(sagaResult.failure.error)
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
      };
    }
  );
}

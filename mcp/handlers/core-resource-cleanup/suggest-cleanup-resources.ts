import { z } from "zod";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { SystemEventRecord } from "../../core/event/system-event-manager.js";
import type { HandlersStatistics } from "../statistics-manager.js";
import { executeSuggestCleanupResources } from "../../core/application/resource/services/resource-cleanup-suggest.js";

export interface DefineSuggestCleanupResourcesDeps extends RegisterGovToolDeps {
  customToolsDir: string;
  governanceFile: string;
  loadGovernanceState: () => Promise<GovernanceState>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  handlersStatistics: HandlersStatistics;
  toPosixPath: (pathValue: string) => string;
}

export function defineSuggestCleanupResourcesTool(deps: DefineSuggestCleanupResourcesDeps): void {
  const {
    govTool,
    customToolsDir,
    governanceFile,
    loadGovernanceState,
    listSkillsCatalog,
    listPresetsCatalog,
    loadSystemEvents,
    handlersStatistics,
    toPosixPath
  } = deps;

  govTool(
    "suggest_cleanup_resources",
    {
      title: "クリーンアップ候補提案",
      description: "30日以上未使用のスキル・プリセット・カスタムツール候補を dry-run で提案します。",
      inputSchema: z.object({
        daysUnused: z.number().int().min(1).max(365).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        resourceTypes: z.array(z.enum(["skills", "tools", "presets"])).min(1).max(3).optional(),
        eventLimit: z.number().int().min(50).max(5000).optional()
      })
    },
    async ({
      daysUnused,
      limit,
      resourceTypes,
      eventLimit
    }: {
      daysUnused?: number;
      limit?: number;
      resourceTypes?: Array<"skills" | "tools" | "presets">;
      eventLimit?: number;
    }) => {
      const payload = await executeSuggestCleanupResources({
        daysUnused,
        limit,
        resourceTypes,
        eventLimit,
        customToolsDir,
        governanceFile,
        loadGovernanceState,
        listSkillsCatalog,
        listPresetsCatalog,
        loadSystemEvents,
        handlersStatistics,
        toPosixPath
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

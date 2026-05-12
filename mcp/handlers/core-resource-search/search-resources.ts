import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { RegisterGovToolDeps, ToolMetadata } from "../types.js";
import { inferCapabilitiesFromText } from "../../core/registry/tool-registry.js";
import {
  executeSearchResources
} from "../../core/application/resource/services/resource-search-operations.js";

export interface DefineSearchResourcesDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, ToolMetadata>;
}

export function defineSearchResourcesTool(deps: DefineSearchResourcesDeps): void {
  const {
    govTool,
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold,
    registeredToolMetadata
  } = deps;

  const outputsDir = resolve(getOutputsDir());
  const proposalFeedbackModelFile = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");
  const querySkillModelFile = join(outputsDir, "tool-proposals", "query-skill-model.json");

  const resolveCapabilityMatchedTools = (text: string): Set<string> => {
    const capabilities = new Set(inferCapabilitiesFromText(text));
    const names = new Set<string>();
    if (capabilities.size === 0) {
      return names;
    }
    for (const [name, meta] of registeredToolMetadata.entries()) {
      const toolText = [name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? [])].join(" ");
      const toolCapabilities = inferCapabilitiesFromText(toolText);
      if (toolCapabilities.some((capability) => capabilities.has(capability))) {
        names.add(name);
      }
    }
    return names;
  };

  govTool(
    "search_resources",
    {
      title: "リソース検索",
      description: "条件に一致するリソースを検索します。",
      inputSchema: z.object({
        query: z.string(),
        resourceTypes: z.array(z.enum(["skills", "tools", "presets"])).optional(),
        limitPerType: z.number().int().min(1).max(20).optional(),
        includeDisabled: z.boolean().optional()
      })
    },
    async ({ query, resourceTypes, limitPerType, includeDisabled }: {
      query: string;
      resourceTypes?: Array<"skills" | "tools" | "presets">;
      limitPerType?: number;
      includeDisabled?: boolean;
    }) => {
      const payload = await executeSearchResources({
        query,
        resourceTypes,
        limitPerType,
        includeDisabled,
        loadGovernanceState,
        listMdFiles,
        listPresetsData,
        scoreByQuery,
        lowRelevanceScoreThreshold,
        emitSystemEvent,
        proposalFeedbackModelFile,
        querySkillModelFile,
        registeredToolMetadata,
        capabilityMatchedToolNames: resolveCapabilityMatchedTools(query)
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

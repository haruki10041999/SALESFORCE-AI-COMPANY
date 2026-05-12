import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { RegisterGovToolDeps, ToolMetadata } from "../types.js";
import { inferCapabilitiesFromText } from "../../core/registry/tool-registry.js";
import {
  executeAutoSelectResources
} from "../../core/application/resource/services/resource-search-operations.js";

export interface DefineAutoSelectResourcesDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, ToolMetadata>;
}

export function defineAutoSelectResourcesTool(deps: DefineAutoSelectResourcesDeps): void {
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
    "auto_select_resources",
    {
      title: "リソース自動選択",
      description: "トピックに適したリソース候補を自動選択します。",
      inputSchema: z.object({
        topic: z.string(),
        limitPerType: z.number().int().min(1).max(10).optional()
      })
    },
    async ({ topic, limitPerType }: { topic: string; limitPerType?: number }) => {
      const payload = await executeAutoSelectResources({
        topic,
        limitPerType,
        loadGovernanceState,
        listMdFiles,
        listPresetsData,
        scoreByQuery,
        lowRelevanceScoreThreshold,
        emitSystemEvent,
        proposalFeedbackModelFile,
        querySkillModelFile,
        registeredToolMetadata,
        capabilityMatchedToolNames: resolveCapabilityMatchedTools(topic)
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

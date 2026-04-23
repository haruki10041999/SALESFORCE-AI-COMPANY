import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

interface RegisterResourceSearchToolsDeps {
  govTool: GovTool;
  loadGovernanceState: () => Promise<any>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, { title?: string; description?: string; tags?: string[] }>;
}

export function registerResourceSearchTools(deps: RegisterResourceSearchToolsDeps): void {
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

  govTool(
    "search_resources",
    {
      title: "Search Resources",
      description: "スキル・ツール・プリセットを横断検索し、関連度スコア付きで返します。includeDisabled: false で無効化リソースを除外できます。",
      inputSchema: {
        query: z.string(),
        resourceTypes: z.array(z.enum(["skills", "tools", "presets"])).optional(),
        limitPerType: z.number().int().min(1).max(20).optional(),
        includeDisabled: z.boolean().optional()
      }
    },
    async ({ query, resourceTypes, limitPerType, includeDisabled }: {
      query: string;
      resourceTypes?: Array<"skills" | "tools" | "presets">;
      limitPerType?: number;
      includeDisabled?: boolean;
    }) => {
      const types = resourceTypes ?? ["skills", "tools", "presets"];
      const limit = limitPerType ?? 5;
      const showDisabled = includeDisabled !== false;
      const state = await loadGovernanceState();

      const skillRows = types.includes("skills")
        ? listMdFiles("skills")
          .map((s) => ({
            name: s.name,
            summary: s.summary,
            score: scoreByQuery(query, s.name, s.summary),
            disabled: state.disabled.skills.includes(s.name)
          }))
          .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
        : [];

      const toolRows = types.includes("tools")
        ? [...registeredToolMetadata.entries()]
          .map(([name, meta]) => ({
            name,
            title: meta.title ?? name,
            description: meta.description ?? "",
            score: scoreByQuery(query, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? [])),
            disabled: state.disabled.tools.includes(name)
          }))
          .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
        : [];

      const presetRows = types.includes("presets")
        ? (await listPresetsData())
          .map((p) => ({
            name: p.name,
            description: p.description,
            topic: p.topic,
            agents: p.agents,
            score: scoreByQuery(query, p.name, p.description, p.topic, p.agents.join(" ")),
            disabled: state.disabled.presets.includes(p.name)
          }))
          .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
        : [];

      const maxSkillScore = skillRows[0]?.score ?? 0;
      const maxToolScore = toolRows[0]?.score ?? 0;
      const maxPresetScore = presetRows[0]?.score ?? 0;
      const overallMax = Math.max(maxSkillScore, maxToolScore, maxPresetScore);
      if (overallMax < lowRelevanceScoreThreshold) {
        await emitSystemEvent("low_relevance_detected", {
          source: "search_resources",
          query,
          maxSkillScore,
          maxToolScore,
          maxPresetScore,
          threshold: lowRelevanceScoreThreshold
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                resourceTypes: types,
                skills: skillRows,
                tools: toolRows,
                presets: presetRows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "auto_select_resources",
    {
      title: "Auto Select Resources",
      description: "トピックから最適なスキル・ツール・プリセット候補を自動選択します。",
      inputSchema: {
        topic: z.string(),
        limitPerType: z.number().int().min(1).max(10).optional()
      }
    },
    async ({ topic, limitPerType }: { topic: string; limitPerType?: number }) => {
      const limit = limitPerType ?? 3;
      const state = await loadGovernanceState();

      const rankedSkills = listMdFiles("skills")
        .map((s) => ({
          name: s.name,
          score: scoreByQuery(topic, s.name, s.summary),
          disabled: state.disabled.skills.includes(s.name)
        }))
        .filter((x) => x.score > 0 && !x.disabled)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const rankedTools = [...registeredToolMetadata.entries()]
        .map(([name, meta]) => ({
          name,
          title: meta.title ?? name,
          score: scoreByQuery(topic, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? [])),
          disabled: state.disabled.tools.includes(name)
        }))
        .filter((x) => x.score > 0 && !x.disabled)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const rankedPresets = (await listPresetsData())
        .map((p) => ({
          name: p.name,
          topic: p.topic,
          description: p.description,
          agents: p.agents,
          score: scoreByQuery(topic, p.name, p.topic, p.description, p.agents.join(" ")),
          disabled: state.disabled.presets.includes(p.name)
        }))
        .filter((x) => x.score > 0 && !x.disabled)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const overallMax = Math.max(
        rankedSkills[0]?.score ?? 0,
        rankedTools[0]?.score ?? 0,
        rankedPresets[0]?.score ?? 0
      );
      if (overallMax < lowRelevanceScoreThreshold) {
        await emitSystemEvent("low_relevance_detected", {
          source: "auto_select_resources",
          topic,
          maxScore: overallMax,
          threshold: lowRelevanceScoreThreshold
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                topic,
                selected: {
                  skills: rankedSkills.map((x) => x.name),
                  tools: rankedTools.map((x) => x.name),
                  presets: rankedPresets.map((x) => x.name)
                },
                detail: {
                  skills: rankedSkills,
                  tools: rankedTools,
                  presets: rankedPresets
                },
                note: "上位候補を返します。エージェントはこの結果を見て適切なツール呼び出しを続けてください。"
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
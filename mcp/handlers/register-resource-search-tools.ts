import { z } from "zod";
import { join, resolve } from "node:path";
import type { GovernanceState } from "../core/governance/governance-state.js";
import {
  applyProposalFeedbackScore,
  loadProposalFeedbackModel,
  type FeedbackResourceType
} from "../core/resource/proposal-feedback.js";
import type { RegisterGovToolDeps, ToolMetadata } from "./types.js";

interface RegisterResourceSearchToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, ToolMetadata>;
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

  const outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs");
  const proposalFeedbackModelFile = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");

  function withFeedbackScore(
    baseScore: number,
    resourceType: FeedbackResourceType,
    name: string,
    model: Awaited<ReturnType<typeof loadProposalFeedbackModel>>
  ): number {
    return applyProposalFeedbackScore(baseScore, resourceType, name, model);
  }

  govTool(
    "search_resources",
    {
      title: "リソース検索",
      description: "条件に一致するリソースを検索します。",
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
      const feedbackModel = await loadProposalFeedbackModel(proposalFeedbackModelFile);

      const skillRows = types.includes("skills")
        ? listMdFiles("skills")
          .map((s) => ({
            name: s.name,
            summary: s.summary,
            score: withFeedbackScore(scoreByQuery(query, s.name, s.summary), "skills", s.name, feedbackModel),
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
            score: withFeedbackScore(
              scoreByQuery(query, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? [])),
              "tools",
              name,
              feedbackModel
            ),
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
            score: withFeedbackScore(
              scoreByQuery(query, p.name, p.description, p.topic, p.agents.join(" ")),
              "presets",
              p.name,
              feedbackModel
            ),
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
      title: "リソース自動選択",
      description: "トピックに適したリソース候補を自動選択します。",
      inputSchema: {
        topic: z.string(),
        limitPerType: z.number().int().min(1).max(10).optional()
      }
    },
    async ({ topic, limitPerType }: { topic: string; limitPerType?: number }) => {
      const limit = limitPerType ?? 3;
      const state = await loadGovernanceState();
      const feedbackModel = await loadProposalFeedbackModel(proposalFeedbackModelFile);

      const rankedSkills = listMdFiles("skills")
        .map((s) => ({
          name: s.name,
          score: withFeedbackScore(scoreByQuery(topic, s.name, s.summary), "skills", s.name, feedbackModel),
          disabled: state.disabled.skills.includes(s.name)
        }))
        .filter((x) => x.score > 0 && !x.disabled)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const rankedTools = [...registeredToolMetadata.entries()]
        .map(([name, meta]) => ({
          name,
          title: meta.title ?? name,
          score: withFeedbackScore(
            scoreByQuery(topic, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? [])),
            "tools",
            name,
            feedbackModel
          ),
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
          score: withFeedbackScore(
            scoreByQuery(topic, p.name, p.topic, p.description, p.agents.join(" ")),
            "presets",
            p.name,
            feedbackModel
          ),
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
                note: "Top candidates are returned. Continue by calling relevant tools with this result."
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

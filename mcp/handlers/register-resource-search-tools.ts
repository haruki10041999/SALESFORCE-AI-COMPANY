import { z } from "zod";
import { join, resolve } from "node:path";
import { promises as fsPromises } from "node:fs";
import type { GovernanceState } from "../core/governance/governance-state.js";
import {
  applyProposalFeedbackScore,
  loadProposalFeedbackModel,
  type FeedbackResourceType
} from "../core/resource/proposal-feedback.js";
import {
  applyQuerySkillIncrementalScore,
  loadQuerySkillIncrementalModel
} from "../core/resource/query-skill-incremental.js";
import {
  appendSkillRatings,
  buildSkillRatingModel,
  loadSkillRatings,
  renderSkillRatingMarkdown,
  saveSkillRatingModel
} from "../core/resource/skill-rating.js";
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
  const querySkillModelFile = join(outputsDir, "tool-proposals", "query-skill-model.json");
  const skillRatingLogFile = join(outputsDir, "reports", "skill-rating.jsonl");
  const skillRatingModelFile = join(outputsDir, "reports", "skill-rating.json");
  const skillRatingReportFile = join(outputsDir, "reports", "skill-rating.md");

  function withFeedbackScore(
    baseScore: number,
    resourceType: FeedbackResourceType,
    name: string,
    model: Awaited<ReturnType<typeof loadProposalFeedbackModel>>
  ): number {
    return applyProposalFeedbackScore(baseScore, resourceType, name, model);
  }

  govTool(
    "record_skill_rating",
    {
      title: "スキル満足度レーティング記録",
      description: "スキル利用後の満足度(1〜5)を記録し、平均評価とトレンドレポートを更新します。",
      inputSchema: {
        ratings: z.array(z.object({
          skill: z.string(),
          rating: z.number().int().min(1).max(5),
          topic: z.string().optional(),
          note: z.string().optional(),
          recordedAt: z.string().optional()
        })).min(1).max(200),
        recentWindow: z.number().int().min(1).max(30).optional(),
        lowRatingThreshold: z.number().min(1).max(5).optional(),
        trendDropThreshold: z.number().min(0).max(5).optional()
      }
    },
    async ({ ratings, recentWindow, lowRatingThreshold, trendDropThreshold }: {
      ratings: Array<{
        skill: string;
        rating: number;
        topic?: string;
        note?: string;
        recordedAt?: string;
      }>;
      recentWindow?: number;
      lowRatingThreshold?: number;
      trendDropThreshold?: number;
    }) => {
      const now = new Date().toISOString();
      const normalizedEntries = ratings.map((row) => ({
        skill: row.skill.trim(),
        rating: row.rating,
        topic: row.topic,
        note: row.note,
        recordedAt: row.recordedAt ?? now
      }));

      await appendSkillRatings(skillRatingLogFile, normalizedEntries);
      const allEntries = await loadSkillRatings(skillRatingLogFile);
      const model = buildSkillRatingModel(
        allEntries,
        recentWindow ?? 5,
        lowRatingThreshold ?? 3,
        trendDropThreshold ?? 0.5
      );
      await saveSkillRatingModel(skillRatingModelFile, model);
      const markdown = renderSkillRatingMarkdown(model);
      await fsPromises.mkdir(join(outputsDir, "reports"), { recursive: true });
      await fsPromises.writeFile(skillRatingReportFile, markdown, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: true,
              newRatingCount: normalizedEntries.length,
              totalRatingCount: model.totals.count,
              averageRating: model.totals.averageRating,
              flaggedForRefactor: model.skills.filter((row) => row.flaggedForRefactor).map((row) => row.skill),
              logFile: skillRatingLogFile,
              reportJsonPath: skillRatingModelFile,
              reportMarkdownPath: skillRatingReportFile
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "get_skill_rating_report",
    {
      title: "スキル満足度レポート取得",
      description: "記録済みレーティングから評価レポートを再生成して返します。",
      inputSchema: {
        recentWindow: z.number().int().min(1).max(30).optional(),
        lowRatingThreshold: z.number().min(1).max(5).optional(),
        trendDropThreshold: z.number().min(0).max(5).optional(),
        maxSkills: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ recentWindow, lowRatingThreshold, trendDropThreshold, maxSkills }: {
      recentWindow?: number;
      lowRatingThreshold?: number;
      trendDropThreshold?: number;
      maxSkills?: number;
    }) => {
      const allEntries = await loadSkillRatings(skillRatingLogFile);
      const model = buildSkillRatingModel(
        allEntries,
        recentWindow ?? 5,
        lowRatingThreshold ?? 3,
        trendDropThreshold ?? 0.5
      );
      await saveSkillRatingModel(skillRatingModelFile, model);
      const markdown = renderSkillRatingMarkdown(model);
      await fsPromises.mkdir(join(outputsDir, "reports"), { recursive: true });
      await fsPromises.writeFile(skillRatingReportFile, markdown, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              updatedAt: model.updatedAt,
              totalRatingCount: model.totals.count,
              averageRating: model.totals.averageRating,
              flaggedForRefactor: model.skills.filter((row) => row.flaggedForRefactor).map((row) => row.skill),
              skills: model.skills.slice(0, maxSkills ?? 50),
              reportJsonPath: skillRatingModelFile,
              reportMarkdownPath: skillRatingReportFile
            }, null, 2)
          }
        ]
      };
    }
  );

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
      const querySkillModel = await loadQuerySkillIncrementalModel(querySkillModelFile);

      const skillRows = types.includes("skills")
        ? listMdFiles("skills")
          .map((s) => ({
            name: s.name,
            summary: s.summary,
            score: applyQuerySkillIncrementalScore(
              withFeedbackScore(scoreByQuery(query, s.name, s.summary), "skills", s.name, feedbackModel),
              query,
              s.name,
              querySkillModel
            ),
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
      const querySkillModel = await loadQuerySkillIncrementalModel(querySkillModelFile);

      const rankedSkills = listMdFiles("skills")
        .map((s) => ({
          name: s.name,
          score: applyQuerySkillIncrementalScore(
            withFeedbackScore(scoreByQuery(topic, s.name, s.summary), "skills", s.name, feedbackModel),
            topic,
            s.name,
            querySkillModel
          ),
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

  govTool(
    "recommend_first_steps",
    {
      title: "最初の一歩提案",
      description: "目的に合わせて最初に実施すべき3ステップを提案します。",
      inputSchema: {
        goal: z.string(),
        limitPerType: z.number().int().min(1).max(5).optional()
      }
    },
    async ({ goal, limitPerType }: { goal: string; limitPerType?: number }) => {
      const limit = limitPerType ?? 3;
      const state = await loadGovernanceState();
      const feedbackModel = await loadProposalFeedbackModel(proposalFeedbackModelFile);
      const querySkillModel = await loadQuerySkillIncrementalModel(querySkillModelFile);

      const agents = listMdFiles("agents")
        .map((agent) => ({
          name: agent.name,
          summary: agent.summary,
          score: scoreByQuery(goal, agent.name, agent.summary)
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const skills = listMdFiles("skills")
        .map((skill) => ({
          name: skill.name,
          summary: skill.summary,
          score: applyQuerySkillIncrementalScore(
            withFeedbackScore(scoreByQuery(goal, skill.name, skill.summary), "skills", skill.name, feedbackModel),
            goal,
            skill.name,
            querySkillModel
          ),
          disabled: state.disabled.skills.includes(skill.name)
        }))
        .filter((row) => row.score > 0 && !row.disabled)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const personas = listMdFiles("personas")
        .map((persona) => ({
          name: persona.name,
          summary: persona.summary,
          score: scoreByQuery(goal, persona.name, persona.summary)
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const docs = listMdFiles("docs/features")
        .map((doc) => ({
          name: `docs/features/${doc.name}.md`,
          summary: doc.summary,
          score: scoreByQuery(goal, doc.name, doc.summary)
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const steps = [
        {
          step: 1,
          title: "担当エージェントを決める",
          action: "agents と personas の上位候補を選び、担当観点を固定する",
          picks: {
            agents: agents.map((x) => x.name),
            personas: personas.map((x) => x.name)
          }
        },
        {
          step: 2,
          title: "実装スキルを適用する",
          action: "skills の上位候補から必要なスキルを選び、実装またはレビューを開始する",
          picks: {
            skills: skills.map((x) => x.name)
          }
        },
        {
          step: 3,
          title: "関連仕様を確認する",
          action: "features ドキュメントを確認し、検証条件と出力形式を揃える",
          picks: {
            docs: docs.map((x) => x.name)
          }
        }
      ];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                goal,
                selected: {
                  agents: agents.map((x) => x.name),
                  skills: skills.map((x) => x.name),
                  personas: personas.map((x) => x.name),
                  docs: docs.map((x) => x.name)
                },
                detail: {
                  agents,
                  skills,
                  personas,
                  docs
                },
                firstSteps: steps
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

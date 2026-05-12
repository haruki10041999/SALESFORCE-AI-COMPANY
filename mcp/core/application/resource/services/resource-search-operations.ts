import type { GovernanceState } from "../../../governance/governance-state.js";
import {
  applyProposalFeedbackScore,
  loadProposalFeedbackModel,
  type FeedbackResourceType
} from "../../../resource/proposal-feedback.js";
import {
  applyQuerySkillIncrementalScore,
  loadQuerySkillIncrementalModel
} from "../../../resource/query-skill-incremental.js";
import {
  appendSkillRatings,
  buildSkillRatingModel,
  loadSkillRatings,
  renderSkillRatingMarkdown,
  saveSkillRatingModel
} from "../../../resource/skill-rating.js";
import { buildResourceScoreExplanation, evaluateAutoSelectionConfidence } from "./resource-score-explainer.js";

export interface ResourceToolMetadata {
  title?: string;
  description?: string;
  tags?: string[];
}

interface MdRow {
  name: string;
  summary: string;
}

function withFeedbackScore(
  baseScore: number,
  resourceType: FeedbackResourceType,
  name: string,
  model: Awaited<ReturnType<typeof loadProposalFeedbackModel>>
): number {
  return applyProposalFeedbackScore(baseScore, resourceType, name, model);
}

export async function executeRecordSkillRating(args: {
  ratings: Array<{ skill: string; rating: number; topic?: string; note?: string; recordedAt?: string }>;
  recentWindow?: number;
  lowRatingThreshold?: number;
  trendDropThreshold?: number;
  skillRatingLogFile: string;
  skillRatingModelFile: string;
  skillRatingReportFile: string;
  writeReportMarkdown: (markdown: string) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const normalizedEntries = args.ratings.map((row) => ({
    skill: row.skill.trim(),
    rating: row.rating,
    topic: row.topic,
    note: row.note,
    recordedAt: row.recordedAt ?? now
  }));

  await appendSkillRatings(args.skillRatingLogFile, normalizedEntries);
  const allEntries = await loadSkillRatings(args.skillRatingLogFile);
  const model = buildSkillRatingModel(
    allEntries,
    args.recentWindow ?? 5,
    args.lowRatingThreshold ?? 3,
    args.trendDropThreshold ?? 0.5
  );
  await saveSkillRatingModel(args.skillRatingModelFile, model);
  const markdown = renderSkillRatingMarkdown(model);
  await args.writeReportMarkdown(markdown);

  return {
    saved: true,
    newRatingCount: normalizedEntries.length,
    totalRatingCount: model.totals.count,
    averageRating: model.totals.averageRating,
    flaggedForRefactor: model.skills.filter((row) => row.flaggedForRefactor).map((row) => row.skill),
    logFile: args.skillRatingLogFile,
    reportJsonPath: args.skillRatingModelFile,
    reportMarkdownPath: args.skillRatingReportFile
  };
}

export async function executeGetSkillRatingReport(args: {
  recentWindow?: number;
  lowRatingThreshold?: number;
  trendDropThreshold?: number;
  maxSkills?: number;
  skillRatingLogFile: string;
  skillRatingModelFile: string;
  skillRatingReportFile: string;
  writeReportMarkdown: (markdown: string) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const allEntries = await loadSkillRatings(args.skillRatingLogFile);
  const model = buildSkillRatingModel(
    allEntries,
    args.recentWindow ?? 5,
    args.lowRatingThreshold ?? 3,
    args.trendDropThreshold ?? 0.5
  );
  await saveSkillRatingModel(args.skillRatingModelFile, model);
  const markdown = renderSkillRatingMarkdown(model);
  await args.writeReportMarkdown(markdown);

  return {
    updatedAt: model.updatedAt,
    totalRatingCount: model.totals.count,
    averageRating: model.totals.averageRating,
    flaggedForRefactor: model.skills.filter((row) => row.flaggedForRefactor).map((row) => row.skill),
    skills: model.skills.slice(0, args.maxSkills ?? 50),
    reportJsonPath: args.skillRatingModelFile,
    reportMarkdownPath: args.skillRatingReportFile
  };
}

export async function executeSearchResources(args: {
  query: string;
  resourceTypes?: Array<"skills" | "tools" | "presets">;
  limitPerType?: number;
  includeDisabled?: boolean;
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => MdRow[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  lowRelevanceScoreThreshold: number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  proposalFeedbackModelFile: string;
  querySkillModelFile: string;
  registeredToolMetadata: Map<string, ResourceToolMetadata>;
  capabilityMatchedToolNames?: ReadonlySet<string>;
  capabilityBoostWeight?: number;
}): Promise<Record<string, unknown>> {
  const types = args.resourceTypes ?? ["skills", "tools", "presets"];
  const limit = args.limitPerType ?? 5;
  const showDisabled = args.includeDisabled !== false;
  const state = await args.loadGovernanceState();
  const feedbackModel = await loadProposalFeedbackModel(args.proposalFeedbackModelFile);
  const querySkillModel = await loadQuerySkillIncrementalModel(args.querySkillModelFile);
  const capabilityBoostWeight = args.capabilityBoostWeight ?? 3;

  const skillRows = types.includes("skills")
    ? args.listMdFiles("skills")
      .map((s) => {
        const baseScore = args.scoreByQuery(args.query, s.name, s.summary);
        const feedbackScore = withFeedbackScore(baseScore, "skills", s.name, feedbackModel);
        const finalScore = applyQuerySkillIncrementalScore(feedbackScore, args.query, s.name, querySkillModel);
        return {
          name: s.name,
          summary: s.summary,
          score: finalScore,
          disabled: state.disabled.skills.includes(s.name),
          explanation: buildResourceScoreExplanation({
            query: args.query,
            baseScore,
            finalScore,
            feedbackMultiplier: baseScore > 0 ? feedbackScore / baseScore : undefined,
            incrementalMultiplier: feedbackScore > 0 ? finalScore / feedbackScore : undefined,
            fields: {
              name: s.name,
              summary: s.summary
            }
          })
        };
      })
      .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    : [];

  const toolRows = types.includes("tools")
    ? [...args.registeredToolMetadata.entries()]
      .map(([name, meta]) => {
        const baseScore = args.scoreByQuery(args.query, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? []));
        const feedbackScore = withFeedbackScore(baseScore, "tools", name, feedbackModel);
        const capabilityBoost = args.capabilityMatchedToolNames?.has(name) ? capabilityBoostWeight : 0;
        const finalScore = feedbackScore + capabilityBoost;
        return {
          name,
          title: meta.title ?? name,
          description: meta.description ?? "",
          score: finalScore,
          disabled: state.disabled.tools.includes(name),
          explanation: buildResourceScoreExplanation({
            query: args.query,
            baseScore,
            finalScore,
            feedbackMultiplier: baseScore > 0 ? feedbackScore / baseScore : undefined,
            fields: {
              name,
              title: meta.title,
              description: meta.description,
              tags: (meta.tags ?? []).join(" "),
              capabilityBoost: capabilityBoost > 0 ? String(capabilityBoost) : undefined
            }
          })
        };
      })
      .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    : [];

  const presetRows = types.includes("presets")
    ? (await args.listPresetsData())
      .map((p) => {
        const baseScore = args.scoreByQuery(args.query, p.name, p.description, p.topic, p.agents.join(" "));
        const finalScore = withFeedbackScore(baseScore, "presets", p.name, feedbackModel);
        return {
          name: p.name,
          description: p.description,
          topic: p.topic,
          agents: p.agents,
          score: finalScore,
          disabled: state.disabled.presets.includes(p.name),
          explanation: buildResourceScoreExplanation({
            query: args.query,
            baseScore,
            finalScore,
            feedbackMultiplier: baseScore > 0 ? finalScore / baseScore : undefined,
            fields: {
              name: p.name,
              description: p.description,
              topic: p.topic,
              agents: p.agents.join(" ")
            }
          })
        };
      })
      .filter((x) => x.score > 0 && (showDisabled || !x.disabled))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    : [];

  const maxSkillScore = skillRows[0]?.score ?? 0;
  const maxToolScore = toolRows[0]?.score ?? 0;
  const maxPresetScore = presetRows[0]?.score ?? 0;
  const overallMax = Math.max(maxSkillScore, maxToolScore, maxPresetScore);
  if (overallMax < args.lowRelevanceScoreThreshold) {
    await args.emitSystemEvent("low_relevance_detected", {
      source: "search_resources",
      query: args.query,
      maxSkillScore,
      maxToolScore,
      maxPresetScore,
      threshold: args.lowRelevanceScoreThreshold
    });
  }

  return {
    query: args.query,
    resourceTypes: types,
    skills: skillRows,
    tools: toolRows,
    presets: presetRows
  };
}

export async function executeAutoSelectResources(args: {
  topic: string;
  limitPerType?: number;
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => MdRow[];
  listPresetsData: () => Promise<Array<{ name: string; description: string; topic: string; agents: string[] }>>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  lowRelevanceScoreThreshold: number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  proposalFeedbackModelFile: string;
  querySkillModelFile: string;
  registeredToolMetadata: Map<string, ResourceToolMetadata>;
  capabilityMatchedToolNames?: ReadonlySet<string>;
  capabilityBoostWeight?: number;
}): Promise<Record<string, unknown>> {
  const limit = args.limitPerType ?? 3;
  const state = await args.loadGovernanceState();
  const feedbackModel = await loadProposalFeedbackModel(args.proposalFeedbackModelFile);
  const querySkillModel = await loadQuerySkillIncrementalModel(args.querySkillModelFile);
  const capabilityBoostWeight = args.capabilityBoostWeight ?? 3;

  const rankedSkills = args.listMdFiles("skills")
    .map((s) => {
      const baseScore = args.scoreByQuery(args.topic, s.name, s.summary);
      const feedbackScore = withFeedbackScore(baseScore, "skills", s.name, feedbackModel);
      const finalScore = applyQuerySkillIncrementalScore(feedbackScore, args.topic, s.name, querySkillModel);
      return {
        name: s.name,
        summary: s.summary,
        score: finalScore,
        disabled: state.disabled.skills.includes(s.name),
        explanation: buildResourceScoreExplanation({
          query: args.topic,
          baseScore,
          finalScore,
          feedbackMultiplier: baseScore > 0 ? feedbackScore / baseScore : undefined,
          incrementalMultiplier: feedbackScore > 0 ? finalScore / feedbackScore : undefined,
          fields: {
            name: s.name,
            summary: s.summary
          }
        })
      };
    })
    .filter((x) => x.score > 0 && !x.disabled)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const rankedTools = [...args.registeredToolMetadata.entries()]
    .map(([name, meta]) => {
      const baseScore = args.scoreByQuery(args.topic, name, meta.title ?? "", meta.description ?? "", ...(meta.tags ?? []));
      const feedbackScore = withFeedbackScore(baseScore, "tools", name, feedbackModel);
      const capabilityBoost = args.capabilityMatchedToolNames?.has(name) ? capabilityBoostWeight : 0;
      const finalScore = feedbackScore + capabilityBoost;
      return {
        name,
        title: meta.title ?? name,
        score: finalScore,
        disabled: state.disabled.tools.includes(name),
        explanation: buildResourceScoreExplanation({
          query: args.topic,
          baseScore,
          finalScore,
          feedbackMultiplier: baseScore > 0 ? feedbackScore / baseScore : undefined,
          fields: {
            name,
            title: meta.title,
            description: meta.description,
            tags: (meta.tags ?? []).join(" "),
            capabilityBoost: capabilityBoost > 0 ? String(capabilityBoost) : undefined
          }
        })
      };
    })
    .filter((x) => x.score > 0 && !x.disabled)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const rankedPresets = (await args.listPresetsData())
    .map((p) => {
      const baseScore = args.scoreByQuery(args.topic, p.name, p.topic, p.description, p.agents.join(" "));
      const finalScore = withFeedbackScore(baseScore, "presets", p.name, feedbackModel);
      return {
        name: p.name,
        topic: p.topic,
        description: p.description,
        agents: p.agents,
        score: finalScore,
        disabled: state.disabled.presets.includes(p.name),
        explanation: buildResourceScoreExplanation({
          query: args.topic,
          baseScore,
          finalScore,
          feedbackMultiplier: baseScore > 0 ? finalScore / baseScore : undefined,
          fields: {
            name: p.name,
            topic: p.topic,
            description: p.description,
            agents: p.agents.join(" ")
          }
        })
      };
    })
    .filter((x) => x.score > 0 && !x.disabled)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const overallMax = Math.max(
    rankedSkills[0]?.score ?? 0,
    rankedTools[0]?.score ?? 0,
    rankedPresets[0]?.score ?? 0
  );

  const confidence = evaluateAutoSelectionConfidence({
    skills: rankedSkills,
    tools: rankedTools,
    presets: rankedPresets
  });

  const selected = {
    skills: rankedSkills.map((x) => x.name),
    tools: rankedTools.map((x) => x.name),
    presets: rankedPresets.map((x) => x.name)
  };

  if (overallMax < args.lowRelevanceScoreThreshold) {
    await args.emitSystemEvent("low_relevance_detected", {
      source: "auto_select_resources",
      topic: args.topic,
      maxScore: overallMax,
      threshold: args.lowRelevanceScoreThreshold
    });
  }

  if (confidence.level === "low") {
    await args.emitSystemEvent("low_confidence_selection", {
      source: "auto_select_resources",
      topic: args.topic,
      topScore: confidence.topScore,
      secondScore: confidence.secondScore,
      scoreGap: confidence.scoreGap,
      relativeGap: confidence.relativeGap,
      signalCount: confidence.signalCount,
      selected
    });
  }

  const fallback = confidence.level === "low"
    ? {
      recommendedTool: "chat",
      reason: "Top candidates are too close. Clarify requirements or run chat with explicit agents/file paths.",
      clarifyingQuestions: [
        "このタスクの最優先は何ですか？（速度 / 品質 / セキュリティ / 保守性）",
        "対象は LWC / Apex / Flow のどれですか？",
        "関連するファイルパスやエラー文はありますか？"
      ]
    }
    : null;

  return {
    topic: args.topic,
    selected,
    confidence,
    detail: {
      skills: rankedSkills,
      tools: rankedTools,
      presets: rankedPresets
    },
    fallback,
    note: "Top candidates are returned. Continue by calling relevant tools with this result."
  };
}

export async function executeRecommendFirstSteps(args: {
  goal: string;
  limitPerType?: number;
  loadGovernanceState: () => Promise<GovernanceState>;
  listMdFiles: (dir: string) => MdRow[];
  scoreByQuery: (query: string, ...targets: string[]) => number;
  proposalFeedbackModelFile: string;
  querySkillModelFile: string;
}): Promise<Record<string, unknown>> {
  const limit = args.limitPerType ?? 3;
  const state = await args.loadGovernanceState();
  const feedbackModel = await loadProposalFeedbackModel(args.proposalFeedbackModelFile);
  const querySkillModel = await loadQuerySkillIncrementalModel(args.querySkillModelFile);

  const agents = args.listMdFiles("agents")
    .map((agent) => ({
      name: agent.name,
      summary: agent.summary,
      score: args.scoreByQuery(args.goal, agent.name, agent.summary)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const skills = args.listMdFiles("skills")
    .map((skill) => ({
      name: skill.name,
      summary: skill.summary,
      score: applyQuerySkillIncrementalScore(
        withFeedbackScore(args.scoreByQuery(args.goal, skill.name, skill.summary), "skills", skill.name, feedbackModel),
        args.goal,
        skill.name,
        querySkillModel
      ),
      disabled: state.disabled.skills.includes(skill.name)
    }))
    .filter((row) => row.score > 0 && !row.disabled)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const personas = args.listMdFiles("personas")
    .map((persona) => ({
      name: persona.name,
      summary: persona.summary,
      score: args.scoreByQuery(args.goal, persona.name, persona.summary)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const docs = args.listMdFiles("docs/features")
    .map((doc) => ({
      name: `docs/features/${doc.name}.md`,
      summary: doc.summary,
      score: args.scoreByQuery(args.goal, doc.name, doc.summary)
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
    goal: args.goal,
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
  };
}
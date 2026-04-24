import { z } from "zod";
import { join, resolve } from "node:path";
import type { GovernanceState, GovernedResourceType } from "../core/governance/governance-state.js";
import { simulateGovernanceChange } from "../tools/simulate-governance-change.js";
import {
  appendProposalFeedback,
  buildProposalFeedbackModel,
  loadProposalFeedbackLog,
  saveProposalFeedbackModel
} from "../core/resource/proposal-feedback.js";
import {
  appendQuerySkillFeedback,
  buildQuerySkillIncrementalModel,
  QUERY_SKILL_MODEL_VERSION,
  loadQuerySkillFeedbackLog,
  saveQuerySkillIncrementalModel
} from "../core/resource/query-skill-incremental.js";
import type { RegisterGovToolDeps } from "./types.js";

type GovernanceActionType = "create" | "delete" | "disable" | "enable";

interface RegisterResourceGovernanceToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function registerResourceGovernanceTools(deps: RegisterResourceGovernanceToolsDeps): void {
  const {
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent
  } = deps;

  const outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs");
  const proposalFeedbackLog = join(outputsDir, "tool-proposals", "proposal-feedback.jsonl");
  const proposalFeedbackModel = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");
  const querySkillFeedbackLog = join(outputsDir, "tool-proposals", "query-skill-feedback.jsonl");
  const querySkillModel = join(outputsDir, "tool-proposals", "query-skill-model.json");

  govTool(
    "proposal_feedback_learn",
    {
      title: "提案ログ学習フィードバック",
      description: "提案の採用/不採用ログを学習し、次回推薦スコア補正モデルを更新します。",
      inputSchema: {
        feedback: z.array(z.object({
          resourceType: z.enum(["skills", "tools", "presets"]),
          name: z.string(),
          decision: z.enum([
            "accepted",
            "rejected",
            "reject_inaccurate",
            "reject_unnecessary",
            "reject_duplicate"
          ]),
          topic: z.string().optional(),
          note: z.string().optional(),
          recordedAt: z.string().optional()
        })).min(1).max(200),
        minSamples: z.number().int().min(1).max(50).optional()
      }
    },
    async ({
      feedback,
      minSamples
    }: {
      feedback: Array<{
        resourceType: "skills" | "tools" | "presets";
        name: string;
        decision:
          | "accepted"
          | "rejected"
          | "reject_inaccurate"
          | "reject_unnecessary"
          | "reject_duplicate";
        topic?: string;
        note?: string;
        recordedAt?: string;
      }>;
      minSamples?: number;
    }) => {
      const now = new Date().toISOString();
      const normalizedEntries = feedback.map((entry) => ({
        resourceType: entry.resourceType,
        name: entry.name,
        decision: entry.decision,
        topic: entry.topic,
        note: entry.note,
        recordedAt: entry.recordedAt ?? now
      }));

      await appendProposalFeedback(proposalFeedbackLog, normalizedEntries);
      const allEntries = await loadProposalFeedbackLog(proposalFeedbackLog);
      const effectiveMinSamples = minSamples ?? 3;
      const model = buildProposalFeedbackModel(allEntries, effectiveMinSamples);
      await saveProposalFeedbackModel(proposalFeedbackModel, model);

      const querySkillEntries = normalizedEntries
        .filter((entry) => entry.resourceType === "skills" && typeof entry.topic === "string" && entry.topic.trim().length > 0)
        .map((entry) => ({
          query: entry.topic!.trim(),
          skill: entry.name,
          decision: (entry.decision === "accepted" ? "accepted" : "rejected") as "accepted" | "rejected",
          recordedAt: entry.recordedAt
        }));
      if (querySkillEntries.length > 0) {
        await appendQuerySkillFeedback(querySkillFeedbackLog, querySkillEntries);
      }
      const allQuerySkillEntries = await loadQuerySkillFeedbackLog(querySkillFeedbackLog);
      const querySkillIncrementalModel = buildQuerySkillIncrementalModel(allQuerySkillEntries);
      await saveQuerySkillIncrementalModel(querySkillModel, querySkillIncrementalModel);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: true,
              logFile: proposalFeedbackLog,
              modelFile: proposalFeedbackModel,
              newFeedbackCount: normalizedEntries.length,
              totalFeedbackCount: model.totals.total,
              totals: model.totals,
              typeAdjustments: model.typeAdjustments,
              topLearnedResources: model.resources.slice(0, 20),
              querySkillModelVersion: QUERY_SKILL_MODEL_VERSION,
              querySkillLogFile: querySkillFeedbackLog,
              querySkillModelFile: querySkillModel,
              querySkillFeedbackCount: allQuerySkillEntries.length,
              topLearnedQuerySkills: querySkillIncrementalModel.skills.slice(0, 20)
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "get_resource_governance",
    {
      title: "リソースガバナンス取得",
      description: "リソースガバナンスの現在状態を取得します。",
      inputSchema: {}
    },
    async () => {
      const state = await loadGovernanceState();
      const counts = await getCatalogCounts(state);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              updatedAt: state.updatedAt,
              config: state.config,
              eventAutomation: state.config.eventAutomation,
              counts,
              disabled: state.disabled,
              usage: state.usage,
              bugSignals: state.bugSignals
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "record_resource_signal",
    {
      title: "リソースシグナル記録",
      description: "リソース利用シグナルを記録します。",
      inputSchema: {
        resourceType: z.enum(["skills", "tools", "presets"]),
        name: z.string(),
        usageIncrement: z.number().int().min(0).max(100).optional(),
        bugIncrement: z.number().int().min(0).max(100).optional()
      }
    },
    async ({ resourceType, name, usageIncrement, bugIncrement }: {
      resourceType: GovernedResourceType;
      name: string;
      usageIncrement?: number;
      bugIncrement?: number;
    }) => {
      const state = await loadGovernanceState();
      state.usage[resourceType][name] = (state.usage[resourceType][name] ?? 0) + (usageIncrement ?? 1);
      state.bugSignals[resourceType][name] = (state.bugSignals[resourceType][name] ?? 0) + (bugIncrement ?? 0);
      await saveGovernanceState(state);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: true,
              resourceType,
              name,
              usage: state.usage[resourceType][name],
              bugSignals: state.bugSignals[resourceType][name]
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "review_resource_governance",
    {
      title: "リソースガバナンスレビュー",
      description: "リソースガバナンスをレビューし提案を返します。",
      inputSchema: {
        updateMaxCounts: z.object({
          skills: z.number().int().min(1).max(200).optional(),
          tools: z.number().int().min(1).max(200).optional(),
          presets: z.number().int().min(1).max(200).optional()
        }).optional(),
        updateThresholds: z.object({
          minUsageToKeep: z.number().int().min(0).max(100).optional(),
          bugSignalToFlag: z.number().int().min(0).max(100).optional()
        }).optional(),
        updateResourceLimits: z.object({
          creationsPerDay: z.number().int().min(1).max(100).optional(),
          deletionsPerDay: z.number().int().min(1).max(100).optional()
        }).optional()
      }
    },
    async ({ updateMaxCounts, updateThresholds, updateResourceLimits }: {
      updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
      updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
      updateResourceLimits?: { creationsPerDay?: number; deletionsPerDay?: number };
    }) => {
      const state = await loadGovernanceState();
      if (updateMaxCounts) {
        state.config.maxCounts = {
          ...state.config.maxCounts,
          ...updateMaxCounts
        };
      }
      if (updateThresholds) {
        state.config.thresholds = {
          ...state.config.thresholds,
          ...updateThresholds
        };
      }
      if (updateResourceLimits) {
        state.config.resourceLimits = {
          ...state.config.resourceLimits,
          ...updateResourceLimits
        };
      }
      await saveGovernanceState(state);

      const counts = await getCatalogCounts(state);
      const recommendations: Array<{
        resourceType: GovernedResourceType;
        action: GovernanceActionType;
        name: string;
        reason: string;
        usage: number;
        bugSignals: number;
        score: number;
      }> = [];

      const catalogs: Record<GovernedResourceType, string[]> = {
        skills: await listSkillsCatalog(),
        tools: listToolsCatalog(state),
        presets: await listPresetsCatalog()
      };

      for (const resourceType of ["skills", "tools", "presets"] as const) {
        const catalog = catalogs[resourceType];
        const max = state.config.maxCounts[resourceType];
        const overflow = Math.max(0, catalog.length - max);

        const sortedByRisk = [...catalog].sort((a, b) => {
          const scoreA = resourceScore(state.usage[resourceType][a] ?? 0, state.bugSignals[resourceType][a] ?? 0);
          const scoreB = resourceScore(state.usage[resourceType][b] ?? 0, state.bugSignals[resourceType][b] ?? 0);
          return scoreA - scoreB;
        });

        for (let index = 0; index < overflow; index++) {
          const name = sortedByRisk[index];
          const usage = state.usage[resourceType][name] ?? 0;
          const bugSignals = state.bugSignals[resourceType][name] ?? 0;
          recommendations.push({
            resourceType,
            action: resourceType === "tools" ? "disable" : "delete",
            name,
            reason: "Auto-generated text.",
            usage,
            bugSignals,
            score: resourceScore(usage, bugSignals)
          });
        }

        for (const name of catalog) {
          const usage = state.usage[resourceType][name] ?? 0;
          const bugSignals = state.bugSignals[resourceType][name] ?? 0;
          if (usage <= state.config.thresholds.minUsageToKeep && bugSignals >= state.config.thresholds.bugSignalToFlag) {
            recommendations.push({
              resourceType,
              action: resourceType === "tools" ? "disable" : "delete",
              name,
              reason: "Auto-generated text.",
              usage,
              bugSignals,
              score: resourceScore(usage, bugSignals)
            });
          }
        }
      }

      if (recommendations.length > 0) {
        await emitSystemEvent("governance_threshold_exceeded", {
          counts,
          thresholds: state.config.thresholds,
          recommendations: recommendations.slice(0, 20),
          recommendationCount: recommendations.length
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              counts,
              maxCounts: state.config.maxCounts,
              thresholds: state.config.thresholds,
              resourceLimits: state.config.resourceLimits,
              recommendations
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "simulate_governance_change",
    {
      title: "ガバナンス変更シミュレーション",
      description: "ガバナンス設定変更を dry-run 評価し、影響リソースと現状との差分を返します。",
      inputSchema: {
        updateMaxCounts: z.object({
          skills: z.number().int().min(1).max(200).optional(),
          tools: z.number().int().min(1).max(200).optional(),
          presets: z.number().int().min(1).max(200).optional()
        }).optional(),
        updateThresholds: z.object({
          minUsageToKeep: z.number().int().min(0).max(100).optional(),
          bugSignalToFlag: z.number().int().min(0).max(100).optional()
        }).optional(),
        previewLimit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({
      updateMaxCounts,
      updateThresholds,
      previewLimit
    }: {
      updateMaxCounts?: { skills?: number; tools?: number; presets?: number };
      updateThresholds?: { minUsageToKeep?: number; bugSignalToFlag?: number };
      previewLimit?: number;
    }) => {
      const state = await loadGovernanceState();
      const counts = await getCatalogCounts(state);
      const catalogs: Record<GovernedResourceType, string[]> = {
        skills: await listSkillsCatalog(),
        tools: listToolsCatalog(state),
        presets: await listPresetsCatalog()
      };

      const simulated = simulateGovernanceChange({
        state,
        catalogs,
        counts,
        resourceScore,
        patch: {
          updateMaxCounts,
          updateThresholds
        },
        previewLimit
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simulated, null, 2)
          }
        ]
      };
    }
  );
}

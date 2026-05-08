import { z } from "zod";
import { join, resolve } from "node:path";
import { promises as fsPromises } from "node:fs";
import type {
  GovernanceState,
  GovernedResourceType,
  ResourceLifecycle
} from "../core/governance/governance-state.js";
import { simulateGovernanceChange } from "../tools/simulate-governance-change.js";
import { renderGovernanceUi } from "../core/governance/governance-ui.js";
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
import { visualizeFeedbackLoop } from "../core/resource/feedback-loop-visualization.js";
import {
  evaluateAllHandlerSchedules,
  validateHandlerScheduleRule,
  type HandlerScheduleRule
} from "../core/governance/handler-schedule.js";
import { suggestRefactors } from "../tools/refactor-suggest.js";
import {
  createFileProposalQueueStore,
  type ProposalQueueStore
} from "../core/resource/proposal/proposal-queue-store.js";
import {
  getDefaultSchedulesFilePath,
  getDueAutoRefactorSchedules,
  loadCleanupSchedules
} from "../core/resource/cleanup-scheduler.js";
import { getDeclinedSkills, loadSkillRatings } from "../core/resource/skill-rating.js";
import type { RegisterGovToolDeps } from "./types.js";
import { OutputsArtifactWriter } from "../core/persistence/outputs-artifact-writer.js";

type GovernanceActionType = "create" | "delete" | "disable" | "enable";

function getEffectiveLifecycle(
  state: GovernanceState,
  resourceType: GovernedResourceType,
  name: string
): ResourceLifecycle {
  if (state.disabled[resourceType].includes(name)) {
    return "disabled";
  }
  return state.lifecycle?.[resourceType]?.[name] ?? "stable";
}

interface RegisterResourceGovernanceToolsDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  getCatalogCounts: (state: GovernanceState) => Promise<Record<GovernedResourceType, number>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  resourceScore: (usage: number, bugs: number) => number;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  proposalQueue?: ProposalQueueStore;
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
  const artifactWriter = new OutputsArtifactWriter({
    outputsDir,
    databaseUrl: process.env.DATABASE_URL
  });
  const proposalQueue = deps.proposalQueue ?? createFileProposalQueueStore(outputsDir);
  const proposalFeedbackLog = join(outputsDir, "tool-proposals", "proposal-feedback.jsonl");
  const proposalFeedbackModel = join(outputsDir, "tool-proposals", "proposal-feedback-model.json");
  const querySkillFeedbackLog = join(outputsDir, "tool-proposals", "query-skill-feedback.jsonl");
  const querySkillModel = join(outputsDir, "tool-proposals", "query-skill-model.json");
  const skillRatingLogFile = join(outputsDir, "reports", "skill-rating.jsonl");

  govTool(
    "auto_refactor_suggest",
    {
      title: "自動リファクタリング提案",
      description: "accept rate が低下したスキルを検出し、refactor_suggest を自動実行して proposal queue に保存します。",
      inputSchema: {
        declineThreshold: z.number().min(0).max(1).optional(),
        days: z.number().int().min(1).max(90).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        respectSchedule: z.boolean().optional(),
        at: z.string().optional()
      }
    },
    async ({ declineThreshold, days, limit, respectSchedule, at }: {
      declineThreshold?: number;
      days?: number;
      limit?: number;
      respectSchedule?: boolean;
      at?: string;
    }) => {
      const now = at ? new Date(at) : new Date();
      const useSchedule = respectSchedule !== false;
      const schedulePath = getDefaultSchedulesFilePath(resolve("."));
      const schedules = await loadCleanupSchedules(schedulePath);
      const dueRefactorSchedules = getDueAutoRefactorSchedules(schedules, now);

      if (useSchedule && dueRefactorSchedules.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              executed: false,
              reason: "no due auto-refactor schedule",
              evaluatedAt: now.toISOString(),
              schedulePath,
              dueCount: 0
            }, null, 2)
          }]
        };
      }

      const entries = await loadSkillRatings(skillRatingLogFile);
      const threshold = declineThreshold ?? 0.15;
      const windowDays = days ?? 14;
      const maxItems = limit ?? 10;
      const declined = getDeclinedSkills(entries, threshold, windowDays, now).slice(0, maxItems);

      const results: Array<{
        skill: string;
        proposalId: string;
        confidence: number;
        delta: number;
        suggestionCount: number;
      }> = [];

      for (const row of declined) {
        const skillPathCandidates = [
          resolve("skills", `${row.skill}.md`),
          resolve("skills", row.skill)
        ];

        let source = "";
        let filePath: string | undefined;
        for (const candidate of skillPathCandidates) {
          try {
            source = await fsPromises.readFile(candidate, "utf-8");
            filePath = candidate;
            break;
          } catch {
            // ignore and try next
          }
        }

        if (source.length === 0) {
          source = `// skill: ${row.skill}\n// No local source file was found.\n`;
        }

        const refactor = suggestRefactors({
          source,
          filePath
        });

        const confidence = Math.max(0, Math.min(1, Number((Math.abs(row.delta)).toFixed(3))));
        const content = [
          `# Auto Refactor Suggestion: ${row.skill}`,
          "",
          `- previousAcceptRate: ${row.previousAcceptRate}`,
          `- currentAcceptRate: ${row.currentAcceptRate}`,
          `- delta: ${row.delta}`,
          `- previousCount: ${row.previousCount}`,
          `- currentCount: ${row.currentCount}`,
          `- analyzedAt: ${now.toISOString()}`,
          "",
          "## refactor_suggest result",
          "```json",
          JSON.stringify(refactor, null, 2),
          "```"
        ].join("\n");

        const record = await proposalQueue.enqueue({
          resourceType: "skills",
          name: row.skill,
          content,
          confidence,
          sourceEvent: "skill_accept_rate_declined",
          origin: "auto-refactor"
        });

        results.push({
          skill: row.skill,
          proposalId: record.id,
          confidence,
          delta: row.delta,
          suggestionCount: refactor.totalSuggestions
        });
      }

      if (results.length > 0) {
        await emitSystemEvent("auto_refactor_suggested", {
          source: "auto_refactor_suggest",
          evaluatedAt: now.toISOString(),
          declineThreshold: threshold,
          windowDays,
          proposalCount: results.length,
          proposals: results
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            executed: true,
            evaluatedAt: now.toISOString(),
            declineThreshold: threshold,
            days: windowDays,
            respectedSchedule: useSchedule,
            dueScheduleCount: dueRefactorSchedules.length,
            scannedRatings: entries.length,
            declinedSkillCount: declined.length,
            proposals: results
          }, null, 2)
        }]
      };
    }
  );

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
    "visualize_feedback_loop",
    {
      title: "Feedback Loop 可視化",
      description: "proposal_feedback_learn で蓄積したフィードバックの推移・トピック別ヒートマップ・トレンドを集計します。",
      inputSchema: {
        periodDays: z.number().int().min(1).max(365).optional(),
        trendWindowDays: z.number().int().min(1).max(180).optional(),
        minSamples: z.number().int().min(1).max(100).optional(),
        topResources: z.number().int().min(1).max(100).optional(),
        topTopics: z.number().int().min(1).max(200).optional()
      }
    },
    async ({
      periodDays,
      trendWindowDays,
      minSamples,
      topResources,
      topTopics
    }: {
      periodDays?: number;
      trendWindowDays?: number;
      minSamples?: number;
      topResources?: number;
      topTopics?: number;
    }) => {
      const entries = await loadProposalFeedbackLog(proposalFeedbackLog);
      const result = visualizeFeedbackLoop(entries, {
        periodDays,
        trendWindowDays,
        minSamples,
        topResources,
        topTopics
      });
      const mdLines = [
        `## Feedback Loop 可視化 (直近 ${result.windowDays}日)`,
        "",
        "| 指標 | 値 |",
        "|------|-----|",
        `| 総フィードバック | ${result.totals.total} |`,
        `| 採択 | ${result.totals.accepted} |`,
        `| 却下 | ${result.totals.rejected} |`,
        `| 採択率 | ${(result.totals.acceptRate * 100).toFixed(1)}% |`,
        ...(result.trends.rising.length > 0
          ? [
            "",
            "### 📈 上昇トレンド",
            ...result.trends.rising.slice(0, 5).map(
              (t) => `- **${t.name}** (${t.resourceType}): ${(t.recentAcceptRate * 100).toFixed(0)}% (+${(t.delta * 100).toFixed(1)}%)`
            )
          ]
          : []),
        ...(result.trends.falling.length > 0
          ? [
            "",
            "### 📉 下降トレンド",
            ...result.trends.falling.slice(0, 5).map(
              (t) => `- **${t.name}** (${t.resourceType}): ${(t.recentAcceptRate * 100).toFixed(0)}% (${(t.delta * 100).toFixed(1)}%)`
            )
          ]
          : []),
        ...(result.timeline.length > 0
          ? [
            "",
            "### タイムライン (直近5日)",
            "| 日付 | 採択 | 却下 | 採択率 |",
            "|------|------|------|--------|  ",
            ...result.timeline.slice(-5).map(
              (p) => `| ${p.date} | ${p.accepted} | ${p.rejected} | ${(p.acceptRate * 100).toFixed(1)}% |`
            )
          ]
          : [])
      ].join("\n");
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
          { type: "text", text: mdLines }
        ]
      };
    }
  );

  govTool(
    "evaluate_handler_schedule",
    {
      title: "ハンドラ時間帯スケジューラ",
      description: "ツール名とスケジュールルールから、現在 (または指定時刻) でハンドラがアクティブかを評価します。",
      inputSchema: {
        toolNames: z.array(z.string()).min(1),
        rules: z.array(z.object({
          toolName: z.string(),
          days: z.array(z.number().int().min(0).max(6)).optional(),
          startHour: z.number().min(0).max(24),
          endHour: z.number().min(0).max(24),
          timezoneOffsetMinutes: z.number().int().min(-14 * 60).max(14 * 60).optional(),
          allow: z.boolean().optional(),
          note: z.string().optional()
        })),
        at: z.string().optional()
      }
    },
    async ({ toolNames, rules, at }: {
      toolNames: string[];
      rules: HandlerScheduleRule[];
      at?: string;
    }) => {
      const validationErrors: Array<{ index: number; errors: string[] }> = [];
      rules.forEach((rule, index) => {
        const errs = validateHandlerScheduleRule(rule);
        if (errs.length > 0) validationErrors.push({ index, errors: errs });
      });
      if (validationErrors.length > 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ validationErrors }, null, 2) }]
        };
      }
      const evalAt = at ? new Date(at) : new Date();
      const evaluations = evaluateAllHandlerSchedules(toolNames, rules, evalAt);
      return {
        content: [{ type: "text", text: JSON.stringify({
          evaluatedAt: evalAt.toISOString(),
          evaluations,
          activeCount: evaluations.filter((e) => e.active).length,
          blockedCount: evaluations.filter((e) => !e.active).length
        }, null, 2) }]
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
              lifecycle: state.lifecycle,
              usage: state.usage,
              bugSignals: state.bugSignals
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "update_resource_lifecycle",
    {
      title: "リソースライフサイクル更新",
      description: "リソースの lifecycle を更新します。disabled は disabled 配列にも同期されます。",
      inputSchema: {
        resourceType: z.enum(["skills", "tools", "presets"]),
        name: z.string(),
        lifecycle: z.enum(["experimental", "stable", "deprecated", "disabled"])
      }
    },
    async ({ resourceType, name, lifecycle }: {
      resourceType: GovernedResourceType;
      name: string;
      lifecycle: ResourceLifecycle;
    }) => {
      const state = await loadGovernanceState();
      state.lifecycle[resourceType] = state.lifecycle[resourceType] ?? {};

      const before = getEffectiveLifecycle(state, resourceType, name);

      if (lifecycle === "stable") {
        delete state.lifecycle[resourceType][name];
        state.disabled[resourceType] = state.disabled[resourceType].filter((n) => n !== name);
      } else if (lifecycle === "disabled") {
        state.lifecycle[resourceType][name] = "disabled";
        if (!state.disabled[resourceType].includes(name)) {
          state.disabled[resourceType].push(name);
        }
      } else {
        state.lifecycle[resourceType][name] = lifecycle;
        state.disabled[resourceType] = state.disabled[resourceType].filter((n) => n !== name);
      }

      await saveGovernanceState(state);

      const afterState = await loadGovernanceState();
      const after = getEffectiveLifecycle(afterState, resourceType, name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              updated: true,
              resourceType,
              name,
              before,
              lifecycle: after,
              disabled: afterState.disabled[resourceType].includes(name)
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "list_resource_lifecycle",
    {
      title: "リソースライフサイクル一覧",
      description: "catalog からリソース lifecycle 一覧を返します。",
      inputSchema: {
        resourceType: z.enum(["skills", "tools", "presets"]).optional(),
        lifecycle: z.enum(["experimental", "stable", "deprecated", "disabled"]).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ resourceType, lifecycle, limit }: {
      resourceType?: GovernedResourceType;
      lifecycle?: ResourceLifecycle;
      limit?: number;
    }) => {
      const state = await loadGovernanceState();
      const limitPerType = limit ?? 200;
      const types = resourceType ? [resourceType] : (["skills", "tools", "presets"] as const);

      const catalogs: Record<GovernedResourceType, string[]> = {
        skills: await listSkillsCatalog(),
        tools: listToolsCatalog(state),
        presets: await listPresetsCatalog()
      };

      const rows = types.flatMap((type) => catalogs[type].map((name) => {
        const stage = getEffectiveLifecycle(state, type, name);
        return {
          resourceType: type,
          name,
          lifecycle: stage,
          disabled: state.disabled[type].includes(name)
        };
      }))
        .filter((row) => (lifecycle ? row.lifecycle === lifecycle : true))
        .slice(0, limitPerType);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              resourceType: resourceType ?? "all",
              lifecycle: lifecycle ?? "all",
              count: rows.length,
              items: rows
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

  govTool(
    "render_governance_ui",
    {
      title: "Governance ルール簡易 Web UI",
      description: "Governance 状態から HTML / Markdown ダッシュボードを生成します。必要時のみ write=true で保存します。",
      inputSchema: {
        format: z.enum(["html", "markdown", "json"]).optional(),
        topPerType: z.number().int().min(1).max(100).optional(),
        title: z.string().optional(),
        write: z.boolean().optional()
      }
    },
    async ({ format, topPerType, title, write }: {
      format?: "html" | "markdown" | "json";
      topPerType?: number;
      title?: string;
      write?: boolean;
    }) => {
      const state = await loadGovernanceState();
      const report = renderGovernanceUi(state, { topPerType, title });

      const dashboardsDir = join(outputsDir, "dashboards");
      const shouldWrite = write === true;
      if (shouldWrite) {
        await artifactWriter.writeText("dashboards/governance.html", report.html);
        await artifactWriter.writeText("dashboards/governance.md", report.markdown);
        await artifactWriter.writeJson("dashboards/governance.json", {
          generatedAt: report.generatedAt,
          thresholds: report.thresholds,
          sections: report.sections,
          totals: report.totals
        });
      }

      const fmt = format ?? "json";
      const text =
        fmt === "html" ? report.html
        : fmt === "markdown" ? report.markdown
        : JSON.stringify({
            generatedAt: report.generatedAt,
            thresholds: report.thresholds,
            sections: report.sections,
            totals: report.totals,
            writtenTo: shouldWrite ? dashboardsDir : null,
            persisted: shouldWrite,
            persistenceNotice: shouldWrite
              ? `dashboard files were written to ${dashboardsDir}`
              : "write=true is not provided; dashboard file persistence is skipped"
          }, null, 2);

      return { content: [{ type: "text", text }] };
    }
  );
}

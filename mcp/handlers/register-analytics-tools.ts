import { promises as fsPromises } from "fs";
import { dirname, resolve, join } from "path";
import { z } from "zod";
import type { GovernanceState } from "../core/governance/governance-state.js";
import type { SystemEventRecord, SystemEventLogStatus } from "../core/event/system-event-manager.js";
import type { AgentMessage, ChatSession, HandlersDashboardState, ExportStatistics } from "../core/types/index.js";
import { getActiveTraces, getCompletedTraces } from "../core/trace/trace-context.js";
import { getMetricsSummary } from "../tools/metrics.js";
import { runAgentAbTest } from "../tools/agent-ab-test.js";
import type { RegisterGovToolDeps } from "./types.js";
import {
  buildObservabilityDashboard,
  type ObservabilityGovernanceFlagged
} from "../core/observability/dashboard.js";
import {
  buildSynergyModel,
  recommendCombo,
  extractSynergyRecordsFromTraces
} from "../core/resource/synergy-model.js";
import { scoreAgentSynergy } from "../tools/agent-synergy-score.js";
import { drillDownDashboard } from "../core/observability/dashboard-drill-down.js";
import { estimatePromptCost } from "../../prompt-engine/prompt-evaluator.js";
import { recordUserFeedback, computeFeedbackMetrics, loadFeedbackForSession } from "../core/learning/feedback-manager.js";
import { summarizeAbCausalHistory, type AgentAbHistoryRun } from "../core/learning/ab-causal-analysis.js";
import {
  createLinUcbState,
  fromLinUcbSnapshot,
  rankLinUcbArms,
  toLinUcbSnapshot,
  updateLinUcbArm,
  type LinUcbSnapshot
} from "../core/learning/lin-ucb-bandit.js";

interface RegisterAnalyticsToolsDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
  loadChatHistories: () => Promise<ChatSession[]>;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  getSystemEventLogStatus: () => Promise<SystemEventLogStatus>;
  loadGovernanceState: () => Promise<GovernanceState>;
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
  exportStatisticsAsCsv: (stats: ExportStatistics) => string;
  exportStatisticsAsJson: (stats: ExportStatistics) => string;
  ensureDir: (dir: string) => Promise<void>;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => {
    estimatedTokens: number;
    containsProjectContext: boolean;
    containsAgentsSection: boolean;
    containsSkillsSection: boolean;
    containsTaskSection: boolean;
    skillCoverageRate: number;
    triggerMatchRate: number;
  };
  outputsDir: string;
}

export function registerAnalyticsTools(deps: RegisterAnalyticsToolsDeps): void {
  const {
    govTool,
    agentLog,
    loadChatHistories,
    loadSystemEvents,
    getSystemEventLogStatus,
    loadGovernanceState,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir,
    runChatTool,
    evaluatePromptMetrics,
    outputsDir
  } = deps;

  function aggregateToolAfterExecuteEvents(events: SystemEventRecord[]): {
    totals: {
      total: number;
      success: number;
      failure: number;
      blockedByDisable: number;
    };
    rates: {
      successRate: number;
      failureRate: number;
    };
    perTool: Record<string, { total: number; success: number; failure: number; blocked: number }>;
  } {
    const perTool: Record<string, { total: number; success: number; failure: number; blocked: number }> = {};
    let total = 0;
    let success = 0;
    let failure = 0;
    let blocked = 0;

    for (const event of events) {
      const payload = (event.payload ?? {}) as {
        toolName?: string;
        success?: boolean;
        blockedByDisable?: boolean;
      };
      const toolName = payload.toolName ?? "unknown";
      const toolStats = perTool[toolName] ?? { total: 0, success: 0, failure: 0, blocked: 0 };

      total += 1;
      toolStats.total += 1;

      if (payload.success === true) {
        success += 1;
        toolStats.success += 1;
      } else {
        failure += 1;
        toolStats.failure += 1;
      }

      if (payload.blockedByDisable === true) {
        blocked += 1;
        toolStats.blocked += 1;
      }

      perTool[toolName] = toolStats;
    }

    return {
      totals: {
        total,
        success,
        failure,
        blockedByDisable: blocked
      },
      rates: {
        successRate: total === 0 ? 0 : Number(((success / total) * 100).toFixed(2)),
        failureRate: total === 0 ? 0 : Number(((failure / total) * 100).toFixed(2))
      },
      perTool
    };
  }

  function duplicateEntries(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        duplicates.add(value);
      } else {
        seen.add(value);
      }
    }
    return [...duplicates].sort();
  }

  async function loadPricingBudgets(): Promise<{
    currency: string;
    dailyLimit: number;
    monthlyLimit: number;
  }> {
    const pricingPath = resolve(outputsDir, "pricing.json");
    try {
      const raw = await fsPromises.readFile(pricingPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        defaults?: { currency?: string };
        budgets?: {
          daily?: { limit?: number };
          monthly?: { limit?: number };
        };
      };
      return {
        currency: parsed.defaults?.currency ?? "USD",
        dailyLimit: parsed.budgets?.daily?.limit ?? 10000,
        monthlyLimit: parsed.budgets?.monthly?.limit ?? 200000
      };
    } catch {
      return {
        currency: "USD",
        dailyLimit: 10000,
        monthlyLimit: 200000
      };
    }
  }

  function generateTriggerRuleRecommendations(
    events: SystemEventRecord[],
    minSupport: number,
    minConfidence: number
  ): Array<{ whenAgent: string; thenAgent: string; confidence: number; support: number; reason: string; once: boolean }> {
    const transitionCounts = new Map<string, number>();
    const fromCounts = new Map<string, number>();

    for (const event of events) {
      const payload = event.payload ?? {};
      const lastAgent = typeof payload.lastAgent === "string" ? payload.lastAgent : null;
      const nextAgents = Array.isArray(payload.nextAgents) ? payload.nextAgents.filter((v) => typeof v === "string") as string[] : [];
      if (!lastAgent || nextAgents.length === 0) continue;

      fromCounts.set(lastAgent, (fromCounts.get(lastAgent) ?? 0) + nextAgents.length);
      for (const nextAgent of nextAgents) {
        const key = `${lastAgent}=>${nextAgent}`;
        transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
      }
    }

    const recommendations: Array<{ whenAgent: string; thenAgent: string; confidence: number; support: number; reason: string; once: boolean }> = [];
    for (const [key, support] of transitionCounts.entries()) {
      if (support < minSupport) continue;
      const [whenAgent, thenAgent] = key.split("=>");
      const totalFrom = fromCounts.get(whenAgent) ?? 1;
      const confidence = support / totalFrom;
      if (confidence < minConfidence) continue;
      recommendations.push({
        whenAgent,
        thenAgent,
        confidence: Number(confidence.toFixed(4)),
        support,
        reason: `auto-tuned from ${support} turn_complete transitions`,
        once: false
      });
    }

    return recommendations.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
  }

  govTool(
    "agent_ab_test",
    {
      title: "エージェントA/B比較",
      description: "同一トピックで2エージェントのチャット出力品質と実行時間を比較します。",
      inputSchema: {
        topic: z.string(),
        agentA: z.string(),
        agentB: z.string(),
        filePaths: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        turns: z.number().int().min(1).max(30).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional(),
        reportOutputDir: z.string().optional(),
        applyOutcomeToTrustStore: z.boolean().optional(),
        trustStoreFilePath: z.string().optional()
      }
    },
    async ({
      topic,
      agentA,
      agentB,
      filePaths,
      persona,
      skills,
      turns,
      maxContextChars,
      appendInstruction,
      reportOutputDir,
      applyOutcomeToTrustStore,
      trustStoreFilePath
    }: {
      topic: string;
      agentA: string;
      agentB: string;
      filePaths?: string[];
      persona?: string;
      skills?: string[];
      turns?: number;
      maxContextChars?: number;
      appendInstruction?: string;
      reportOutputDir?: string;
      applyOutcomeToTrustStore?: boolean;
      trustStoreFilePath?: string;
    }) => {
      const result = await runAgentAbTest(
        {
          topic,
          agentA,
          agentB,
          filePaths,
          persona,
          skills,
          turns,
          maxContextChars,
          appendInstruction,
          reportOutputDir,
          applyOutcomeToTrustStore,
          trustStoreFilePath
        },
        {
          runChatTool,
          evaluatePromptMetrics,
          outputsDir
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "health_check",
    {
      title: "ヘルスチェック",
      description: "システムの健全性を確認します。",
      inputSchema: {
        systemEventLimit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ systemEventLimit }: { systemEventLimit?: number }) => {
      const eventLimit = systemEventLimit ?? 100;
      const toolAfterEvents = await loadSystemEvents(eventLimit, "tool_after_execute");
      const aggregate = aggregateToolAfterExecuteEvents(toolAfterEvents);
      const governanceState = await loadGovernanceState();
      const dashboard = generateHandlersDashboard(handlersState);
      const eventLogs = await getSystemEventLogStatus();
      const activeTraces = getActiveTraces();
      const recentCompletedTraces = getCompletedTraces(100);
      const metricsSummary = getMetricsSummary();
      const duplicateDisabledSkills = duplicateEntries(governanceState.disabled.skills);
      const duplicateDisabledTools = duplicateEntries(governanceState.disabled.tools);
      const duplicateDisabledPresets = duplicateEntries(governanceState.disabled.presets);
      const duplicateProtectedTools = duplicateEntries(governanceState.config.eventAutomation.protectedTools);

      const governanceValidation = {
        duplicateEntries: {
          disabledSkills: duplicateDisabledSkills,
          disabledTools: duplicateDisabledTools,
          disabledPresets: duplicateDisabledPresets,
          protectedTools: duplicateProtectedTools
        },
        configSanity: {
          maxCountsPositive:
            governanceState.config.maxCounts.skills > 0 &&
            governanceState.config.maxCounts.tools > 0 &&
            governanceState.config.maxCounts.presets > 0,
          retryWindowValid:
            governanceState.config.toolExecution.baseDelayMs > 0 &&
            governanceState.config.toolExecution.maxDelayMs >= governanceState.config.toolExecution.baseDelayMs,
          thresholdsNonNegative:
            governanceState.config.thresholds.minUsageToKeep >= 0 &&
            governanceState.config.thresholds.bugSignalToFlag >= 0
        }
      };
      const governanceWarnings = [
        ...duplicateDisabledSkills.map((name) => `disabled.skills duplicate: ${name}`),
        ...duplicateDisabledTools.map((name) => `disabled.tools duplicate: ${name}`),
        ...duplicateDisabledPresets.map((name) => `disabled.presets duplicate: ${name}`),
        ...duplicateProtectedTools.map((name) => `protectedTools duplicate: ${name}`)
      ];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                checkedAt: new Date().toISOString(),
                toolExecutions: {
                  sampled: toolAfterEvents.length,
                  totals: aggregate.totals,
                  rates: aggregate.rates
                },
                disabledResources: {
                  skills: governanceState.disabled.skills.length,
                  tools: governanceState.disabled.tools.length,
                  presets: governanceState.disabled.presets.length
                },
                governanceValidation,
                governanceWarnings,
                traces: {
                  activeCount: activeTraces.length,
                  recentCompletedCount: recentCompletedTraces.length,
                  recentCompleted: recentCompletedTraces.slice(0, 10)
                },
                metrics: {
                  totalCalls: metricsSummary.totalCalls,
                  totalErrors: metricsSummary.totalErrors,
                  overallSuccessRate: metricsSummary.overallSuccessRate,
                  overallAvgDurationMs: metricsSummary.overallAvgDurationMs,
                  topTools: metricsSummary.perTool.slice(0, 10)
                },
                eventLogs,
                handlers: dashboard
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
    "analyze_chat_trends",
    {
      title: "チャット傾向分析",
      description: "チャットログの傾向を分析します。",
      inputSchema: {
        historyId: z.string().optional(),
        since: z.string().optional(),
        groupBy: z.enum(["agent", "topic"]).optional()
      }
    },
    async ({ historyId, since, groupBy }: { historyId?: string; since?: string; groupBy?: "agent" | "topic" }) => {
      let targetEntries: AgentMessage[] = agentLog;

      if (historyId) {
        const session = await loadChatHistories().then((sessions) => sessions.find((entry) => entry.id === historyId));
        if (!session) {
          return { content: [{ type: "text", text: `History not found: ${historyId}` }] };
        }
        targetEntries = session.entries;
      }

      if (since) {
        const cutoff = new Date(since);
        targetEntries = targetEntries.filter((entry) => new Date(entry.timestamp) >= cutoff);
      }

      const key = groupBy ?? "agent";
      const stats: Record<string, { count: number; avgLength: number; topics?: string[]; agents?: string[] }> = {};

      for (const entry of targetEntries) {
        const groupName = key === "topic" ? (entry.topic ?? "unknown") : entry.agent;
        if (!stats[groupName]) {
          stats[groupName] = { count: 0, avgLength: 0, ...(key === "agent" ? { topics: [] } : { agents: [] }) };
        }
        stats[groupName].count++;
        const previousAverage = stats[groupName].avgLength;
        stats[groupName].avgLength = previousAverage + (entry.message.length - previousAverage) / stats[groupName].count;
        if (key === "agent" && entry.topic && !stats[groupName].topics!.includes(entry.topic)) {
          stats[groupName].topics!.push(entry.topic);
        }
        if (key === "topic" && !stats[groupName].agents!.includes(entry.agent)) {
          stats[groupName].agents!.push(entry.agent);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalMessages: targetEntries.length,
                uniqueGroups: Object.keys(stats).length,
                groupBy: key,
                historyId: historyId ?? "current",
                since: since ?? null,
                stats
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
    "get_tool_execution_statistics",
    {
      title: "ツール実行統計取得",
      description: "ツール実行の統計情報を取得します。",
      inputSchema: {
        windowMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
        windowsMinutes: z.array(z.number().int().min(1).max(7 * 24 * 60)).max(10).optional(),
        bucketMinutes: z.number().int().min(5).max(180).optional(),
        limit: z.number().int().min(10).max(2000).optional()
      }
    },
    async ({ windowMinutes, windowsMinutes, bucketMinutes, limit }: {
      windowMinutes?: number;
      windowsMinutes?: number[];
      bucketMinutes?: number;
      limit?: number;
    }) => {
      const now = Date.now();
      const windowMs = (windowMinutes ?? 60) * 60 * 1000;
      const eventLimit = limit ?? 1000;
      const events = await loadSystemEvents(eventLimit, "tool_after_execute");
      const relevant = events.filter((event) => {
        const ts = Date.parse(event.timestamp ?? "");
        return Number.isFinite(ts) && now - ts <= windowMs;
      });
      const aggregate = aggregateToolAfterExecuteEvents(relevant);

      const windowCandidates = windowsMinutes && windowsMinutes.length > 0
        ? windowsMinutes
        : [60, 24 * 60, 7 * 24 * 60];
      const normalizedWindows = [...new Set(windowCandidates)].sort((a, b) => a - b);
      const windowSummaries = normalizedWindows.map((minutes) => {
        const cutoff = now - minutes * 60 * 1000;
        const scopedEvents = events.filter((event) => {
          const ts = Date.parse(event.timestamp ?? "");
          return Number.isFinite(ts) && ts >= cutoff;
        });
        const scopedAggregate = aggregateToolAfterExecuteEvents(scopedEvents);
        return {
          windowMinutes: minutes,
          sampledEvents: scopedEvents.length,
          totals: scopedAggregate.totals,
          rates: scopedAggregate.rates
        };
      });

      const bucketSizeMinutes = bucketMinutes ?? 60;
      const bucketSizeMs = bucketSizeMinutes * 60 * 1000;
      const timelineBuckets = new Map<number, SystemEventRecord[]>();
      for (const event of relevant) {
        const ts = Date.parse(event.timestamp ?? "");
        if (!Number.isFinite(ts)) {
          continue;
        }
        const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
        const bucketEvents = timelineBuckets.get(bucketStart) ?? [];
        bucketEvents.push(event);
        timelineBuckets.set(bucketStart, bucketEvents);
      }
      const timeline = [...timelineBuckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bucketStart, bucketEvents]) => {
          const scopedAggregate = aggregateToolAfterExecuteEvents(bucketEvents);
          return {
            bucketStart: new Date(bucketStart).toISOString(),
            bucketMinutes: bucketSizeMinutes,
            totals: scopedAggregate.totals,
            rates: scopedAggregate.rates
          };
        });

      const governanceState = await loadGovernanceState();
      const disabledTools = Array.isArray(governanceState?.disabled?.tools)
        ? governanceState.disabled.tools
        : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                windowMinutes: windowMinutes ?? 60,
                sampledEvents: relevant.length,
                totals: aggregate.totals,
                rates: aggregate.rates,
                disabledTools: {
                  count: disabledTools.length,
                  names: disabledTools
                },
                perTool: aggregate.perTool,
                windows: windowSummaries,
                timeline
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
    "get_handlers_dashboard",
    {
      title: "ハンドラーダッシュボード取得",
      description: "ハンドラーのダッシュボード情報を取得します。",
      inputSchema: {}
    },
    async () => {
      const dashboard = generateHandlersDashboard(handlersState);
      return {
        content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }]
      };
    }
  );

  govTool(
    "export_handlers_statistics",
    {
      title: "ハンドラー統計エクスポート",
      description: "ハンドラー統計をエクスポートします。",
      inputSchema: {
        format: z.enum(["json", "csv"]).optional(),
        outputPath: z.string().optional()
      }
    },
    async ({ format, outputPath }: { format?: "json" | "csv"; outputPath?: string }) => {
      const stats: ExportStatistics = {
        created: handlersState.createdTracker,
        deleted: handlersState.deletedTracker,
        errors: handlersState.errorTracker,
        qualityFailures: handlersState.qualityTracker,
        lastUpdated: new Date().toISOString()
      };
      const content = format === "csv"
        ? exportStatisticsAsCsv(stats)
        : exportStatisticsAsJson(stats);

      if (outputPath) {
        const destination = resolve(outputPath);
        await ensureDir(dirname(destination));
        await fsPromises.writeFile(destination, content, "utf-8");
      }

      return { content: [{ type: "text", text: content }] };
    }
  );

  // TASK-044: Unified Observability Dashboard
  govTool(
    "observability_dashboard",
    {
      title: "Observability Dashboard",
      description:
        "trace + system_event + governance_state を join した HTML/Markdown ダッシュボードを生成し、outputs/dashboards/observability.* に保存します。",
      inputSchema: {
        eventLimit: z.number().int().min(50).max(5000).optional(),
        traceLimit: z.number().int().min(10).max(500).optional(),
        correlationWindowMs: z.number().int().min(100).max(60000).optional(),
        format: z.enum(["html", "markdown", "json"]).optional(),
        write: z.boolean().optional()
      }
    },
    async ({
      eventLimit,
      traceLimit,
      correlationWindowMs,
      format,
      write
    }: {
      eventLimit?: number;
      traceLimit?: number;
      correlationWindowMs?: number;
      format?: "html" | "markdown" | "json";
      write?: boolean;
    }) => {
      const traces = [...getCompletedTraces(traceLimit ?? 100), ...getActiveTraces()].map((t) => ({
        traceId: t.traceId,
        toolName: t.toolName,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        durationMs: t.durationMs,
        status: t.status,
        errorMessage: t.errorMessage,
        metadata: t.metadata
      }));
      const events = (await loadSystemEvents(eventLimit ?? 1000)).map((e) => ({
        id: e.id,
        event: e.event,
        timestamp: e.timestamp,
        payload: e.payload
      }));

      const state = await loadGovernanceState();
      const flagged: ObservabilityGovernanceFlagged[] = [];
      const types: Array<"skills" | "tools" | "presets"> = ["skills", "tools", "presets"];
      for (const t of types) {
        for (const name of state.disabled?.[t] ?? []) {
          flagged.push({ resourceType: t, name, reason: "disabled" });
        }
        const bugThreshold = state.config?.thresholds?.bugSignalToFlag ?? 5;
        const bugMap = state.bugSignals?.[t] ?? {};
        for (const [name, count] of Object.entries(bugMap)) {
          if (typeof count === "number" && count >= bugThreshold) {
            flagged.push({ resourceType: t, name, reason: `bugSignals=${count}` });
          }
        }
      }

      const report = buildObservabilityDashboard({
        traces,
        events,
        governanceFlagged: flagged,
        correlationWindowMs,
        recentLimit: traceLimit ?? 50
      });

      const dashboardsDir = join(outputsDir, "dashboards");
      const shouldWrite = write !== false;
      if (shouldWrite) {
        await ensureDir(dashboardsDir);
        await fsPromises.writeFile(join(dashboardsDir, "observability.html"), report.html, "utf-8");
        await fsPromises.writeFile(join(dashboardsDir, "observability.md"), report.markdown, "utf-8");
        await fsPromises.writeFile(
          join(dashboardsDir, "observability.json"),
          JSON.stringify({ summary: report.summary, correlations: report.correlations, governanceFlagged: report.governanceFlagged }, null, 2),
          "utf-8"
        );
      }

      const fmt = format ?? "json";
      const text =
        fmt === "html"
          ? report.html
          : fmt === "markdown"
          ? report.markdown
          : JSON.stringify(
              {
                summary: report.summary,
                correlations: report.correlations,
                governanceFlagged: report.governanceFlagged,
                writtenTo: shouldWrite ? dashboardsDir : null
              },
              null,
              2
            );

      return { content: [{ type: "text", text }] };
    }
  );

  // TASK-043: Agent×Skill Synergy Recommendation
  govTool(
    "synergy_recommend_combo",
    {
      title: "Agent×Skill Synergy 推薦",
      description:
        "過去 trace から (agent, skill) 共起・成功率を学習し、与えられた候補集合から相性 top-N の組合せを提案します。",
      inputSchema: {
        agents: z.array(z.string()).min(1).max(50).optional(),
        skills: z.array(z.string()).min(1).max(100).optional(),
        traceLimit: z.number().int().min(10).max(1000).optional(),
        limit: z.number().int().min(1).max(20).optional(),
        minScore: z.number().min(0).max(1).optional()
      }
    },
    async ({
      agents,
      skills,
      traceLimit,
      limit,
      minScore
    }: {
      agents?: string[];
      skills?: string[];
      traceLimit?: number;
      limit?: number;
      minScore?: number;
    }) => {
      const traces = getCompletedTraces(traceLimit ?? 200).map((t) => ({
        status: t.status,
        endedAt: t.endedAt,
        metadata: t.metadata
      }));

      const records = extractSynergyRecordsFromTraces(traces);
      const model = buildSynergyModel(records);

      // 与えられた候補が無ければ model 内全 pair を使う
      const candidateAgents = agents && agents.length > 0
        ? agents
        : Array.from(new Set([...model.pairs.values()].map((p) => p.agent)));
      const candidateSkills = skills && skills.length > 0
        ? skills
        : Array.from(new Set([...model.pairs.values()].map((p) => p.skill)));

      const combos = recommendCombo(model, {
        agents: candidateAgents,
        skills: candidateSkills,
        limit: limit ?? 5,
        minScore: minScore ?? 0
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                trainedFromTraces: records.length,
                pairsLearned: model.pairs.size,
                combos
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
    "score_agent_synergy",
    {
      title: "エージェント協調スコア",
      description: "チャット履歴からエージェントペアの協調 (lift) とスコアを算出します。",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        minCooccurrence: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ limit, minCooccurrence }: { limit?: number; minCooccurrence?: number }) => {
      const sessions = await loadChatHistories();
      const result = scoreAgentSynergy(sessions, { limit, minCooccurrence });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "drill_down_dashboard",
    {
      title: "ダッシュボード drill-down",
      description: "特定ツール / ステータス / 期間 / イベント種別で trace と event を絞り込み、詳細と集計を返します。",
      inputSchema: {
        toolName: z.string().optional(),
        status: z.enum(["running", "success", "error"]).optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        eventType: z.string().optional(),
        eventLimit: z.number().int().min(50).max(5000).optional(),
        traceLimit: z.number().int().min(10).max(5000).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({
      toolName,
      status,
      since,
      until,
      eventType,
      eventLimit,
      traceLimit,
      limit
    }: {
      toolName?: string;
      status?: "running" | "success" | "error";
      since?: string;
      until?: string;
      eventType?: string;
      eventLimit?: number;
      traceLimit?: number;
      limit?: number;
    }) => {
      const traces = [...getCompletedTraces(traceLimit ?? 200), ...getActiveTraces()].map((t) => ({
        traceId: t.traceId,
        toolName: t.toolName,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        durationMs: t.durationMs,
        status: t.status,
        errorMessage: t.errorMessage,
        metadata: t.metadata
      }));
      const events = (await loadSystemEvents(eventLimit ?? 1000)).map((e) => ({
        id: e.id,
        event: e.event,
        timestamp: e.timestamp,
        payload: e.payload
      }));
      const result = drillDownDashboard(traces, events, {
        toolName,
        status,
        since,
        until,
        eventType,
        limit
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

    // F-25: ユーザーフィードバック記録
    govTool(
      "tune_trigger_rules",
      {
        title: "トリガールール自動調整",
        description: "turn_complete イベント履歴から遷移傾向を抽出し、トリガールール候補を提案します。",
        inputSchema: {
          eventLimit: z.number().int().min(50).max(5000).optional(),
          minSupport: z.number().int().min(1).max(500).optional(),
          minConfidence: z.number().min(0).max(1).optional(),
          apply: z.boolean().optional()
        }
      },
      async ({ eventLimit, minSupport, minConfidence, apply }: { eventLimit?: number; minSupport?: number; minConfidence?: number; apply?: boolean }) => {
        const limit = eventLimit ?? 1000;
        const support = minSupport ?? 3;
        const confidence = minConfidence ?? 0.6;
        const events = await loadSystemEvents(limit, "turn_complete");
        const recommendations = generateTriggerRuleRecommendations(events, support, confidence);
        const outputDir = resolve(outputsDir, "reports", "trigger-tuning");
        await ensureDir(outputDir);
        const reportPath = join(outputDir, "latest.json");

        const report = {
          generatedAt: new Date().toISOString(),
          sourceEventCount: events.length,
          minSupport: support,
          minConfidence: confidence,
          recommendations
        };
        await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

        let appliedPath: string | null = null;
        if (apply) {
          const triggerRulesPath = resolve(outputsDir, "trigger-rules.json");
          const rules = recommendations.map((r) => ({
            whenAgent: r.whenAgent,
            thenAgent: r.thenAgent,
            reason: r.reason,
            once: r.once
          }));
          await fsPromises.writeFile(triggerRulesPath, JSON.stringify({ updatedAt: new Date().toISOString(), rules }, null, 2), "utf-8");
          appliedPath = triggerRulesPath;
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              reportPath,
              recommendationCount: recommendations.length,
              topRecommendations: recommendations.slice(0, 10),
              appliedPath
            }, null, 2)
          }]
        };
      }
    );

    govTool(
      "evaluate_cost_sla",
      {
        title: "コストSLA評価",
        description: "Prompt 推定コストが日次/月次予算SLAを満たすか評価します。",
        inputSchema: {
          prompt: z.string().min(1),
          modelName: z.string().optional(),
          outputTokenEstimate: z.number().optional(),
          expectedDailyRequests: z.number().int().min(1).optional(),
          expectedMonthlyRequests: z.number().int().min(1).optional(),
          dailyBudget: z.number().min(0).optional(),
          monthlyBudget: z.number().min(0).optional()
        }
      },
      async ({ prompt, modelName, outputTokenEstimate, expectedDailyRequests, expectedMonthlyRequests, dailyBudget, monthlyBudget }: {
        prompt: string;
        modelName?: string;
        outputTokenEstimate?: number;
        expectedDailyRequests?: number;
        expectedMonthlyRequests?: number;
        dailyBudget?: number;
        monthlyBudget?: number;
      }) => {
        const rawMetrics = evaluatePromptMetrics(prompt);
        const metrics = {
          estimatedTokens: rawMetrics.estimatedTokens,
          lengthChars: 0,
          lineCount: 0,
          containsProjectContext: rawMetrics.containsProjectContext,
          containsAgentsSection: rawMetrics.containsAgentsSection,
          containsSkillsSection: rawMetrics.containsSkillsSection,
          containsTaskSection: rawMetrics.containsTaskSection,
          matchedSkillCount: 0,
          totalSkillCount: 0,
          matchedTriggerCount: 0,
          totalTriggerCount: 0,
          skillCoverageRate: rawMetrics.skillCoverageRate,
          triggerMatchRate: rawMetrics.triggerMatchRate
        };
        const estimate = estimatePromptCost(metrics, modelName ?? "mistral", outputTokenEstimate);
        const budgets = await loadPricingBudgets();
        const dailyReq = expectedDailyRequests ?? 100;
        const monthlyReq = expectedMonthlyRequests ?? 3000;
        const effDailyBudget = dailyBudget ?? budgets.dailyLimit;
        const effMonthlyBudget = monthlyBudget ?? budgets.monthlyLimit;

        const projectedDailyCost = estimate.totalCost * dailyReq;
        const projectedMonthlyCost = estimate.totalCost * monthlyReq;

        const result = {
          model: estimate.model,
          currency: estimate.currency ?? budgets.currency,
          requestCost: estimate.totalCost,
          projections: {
            expectedDailyRequests: dailyReq,
            projectedDailyCost,
            dailyBudget: effDailyBudget,
            dailyBudgetRemaining: effDailyBudget - projectedDailyCost,
            dailySlaPass: projectedDailyCost <= effDailyBudget,
            expectedMonthlyRequests: monthlyReq,
            projectedMonthlyCost,
            monthlyBudget: effMonthlyBudget,
            monthlyBudgetRemaining: effMonthlyBudget - projectedMonthlyCost,
            monthlySlaPass: projectedMonthlyCost <= effMonthlyBudget
          }
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    );

    govTool(
      "analyze_ab_test_history",
      {
        title: "A/Bテスト履歴分析",
        description: "agent_ab_test の runs.jsonl を集計して勝率と品質傾向を分析します。",
        inputSchema: {
          reportDir: z.string().optional(),
          minRuns: z.number().int().min(1).max(1000).optional()
        }
      },
      async ({ reportDir, minRuns }: { reportDir?: string; minRuns?: number }) => {
        const dir = reportDir ? resolve(reportDir) : resolve(outputsDir, "reports", "agent-ab-test");
        const runsPath = join(dir, "runs.jsonl");
        const content = await fsPromises.readFile(runsPath, "utf-8");
        const allRuns = content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as AgentAbHistoryRun);
        const summary = summarizeAbCausalHistory(allRuns);
        const effectiveMinRuns = minRuns ?? 1;
        const filteredRanking = summary.agentRanking.filter((row) => row.runs >= effectiveMinRuns);
        const filteredComparisons = summary.comparisons.filter((row) => row.runs >= effectiveMinRuns);

        const analysisPath = join(dir, "analysis-latest.json");
        await fsPromises.writeFile(analysisPath, JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceRunsPath: runsPath,
          minRuns: effectiveMinRuns,
          totalRuns: summary.totalRuns,
          agentRanking: filteredRanking,
          comparisons: filteredComparisons,
          monthlyStrata: summary.monthlyStrata
        }, null, 2), "utf-8");

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              analysisPath,
              totalRuns: summary.totalRuns,
              topAgents: filteredRanking.slice(0, 10),
              comparisons: filteredComparisons.slice(0, 10),
              monthlyStrata: summary.monthlyStrata
            }, null, 2)
          }]
        };
      }
    );

    // F-19: Contextual Bandit (LinUCB) による候補腕の推奨。
    govTool(
      "linucb_rank_arms",
      {
        title: "LinUCB 候補推奨",
        description: "特徴量と報酬履歴から LinUCB で候補をランキングします。",
        inputSchema: {
          arms: z.array(
            z.object({
              name: z.string().min(1),
              features: z.array(z.number()).min(1)
            })
          ).min(1),
          feedbacks: z.array(
            z.object({
              name: z.string().min(1),
              features: z.array(z.number()).min(1),
              reward: z.number()
            })
          ).optional(),
          alpha: z.number().min(0).max(10).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          snapshot: z.any().optional()
        }
      },
      async ({
        arms,
        feedbacks,
        alpha,
        limit,
        snapshot
      }: {
        arms: Array<{ name: string; features: number[] }>;
        feedbacks?: Array<{ name: string; features: number[]; reward: number }>;
        alpha?: number;
        limit?: number;
        snapshot?: LinUcbSnapshot;
      }) => {
        const dimension = arms[0]?.features.length ?? 0;
        if (dimension <= 0) {
          throw new Error("arms.features must contain at least one value");
        }

        const state = snapshot
          ? fromLinUcbSnapshot(snapshot)
          : createLinUcbState(
              dimension,
              [...new Set(arms.map((a) => a.name))]
            );

        if (state.dimension !== dimension) {
          throw new Error(`snapshot dimension mismatch: snapshot=${state.dimension}, arms=${dimension}`);
        }

        for (const fb of feedbacks ?? []) {
          updateLinUcbArm(state, fb.name, fb.features, fb.reward);
        }

        const ranking = rankLinUcbArms(state, arms, alpha ?? 1, limit);
        const out = {
          recommended: ranking[0] ?? null,
          ranking,
          snapshot: toLinUcbSnapshot(state)
        };

        return {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }]
        };
      }
    );

    govTool(
      "record_user_feedback",
      {
        title: "ユーザーフィードバック記録",
        description: "チャットセッションの品質に対するユーザーの評価 (👍/👎) を記録します。",
        inputSchema: {
          sessionId: z.string().min(1).describe("関連するチャットセッション ID"),
          rating: z.enum(["thumbs-up", "thumbs-down", "neutral"]).describe("評価: thumbs-up, thumbs-down, neutral"),
          agentName: z.string().optional().describe("対応エージェント名"),
          comment: z.string().optional().describe("ユーザーのコメント"),
          qualityScore: z.number().min(0).max(1).optional().describe("品質スコア (0-1)"),
          tags: z.array(z.string()).optional().describe("カテゴリタグ")
        }
      },
      async (input: {
        sessionId: string;
        rating: "thumbs-up" | "thumbs-down" | "neutral";
        agentName?: string;
        comment?: string;
        qualityScore?: number;
        tags?: string[];
      }) => {
        const feedback = await recordUserFeedback(input);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, feedbackId: feedback.feedbackId, timestamp: feedback.timestamp }, null, 2) }]
        };
      }
    );

    // F-25: フィードバックメトリクス取得
    govTool(
      "get_feedback_metrics",
      {
        title: "フィードバックメトリクス",
        description: "記録されたユーザーフィードバックの集計統計を取得します。",
        inputSchema: {
          sessionId: z.string().optional().describe("特定セッションに限定 (省略時は全体)")
        }
      },
      async ({ sessionId }: { sessionId?: string }) => {
        const metrics = await computeFeedbackMetrics(sessionId);
        return {
          content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }]
        };
      }
    );

    // F-25: セッション別フィードバック取得
    govTool(
      "get_session_feedback",
      {
        title: "セッションフィードバック",
        description: "特定のチャットセッションに対する全フィードバック記録を取得します。",
        inputSchema: {
          sessionId: z.string().min(1).describe("チャットセッション ID")
        }
      },
      async ({ sessionId }: { sessionId: string }) => {
        const feedback = await loadFeedbackForSession(sessionId);
        return {
          content: [{ type: "text", text: JSON.stringify({ sessionId, feedbackCount: feedback.length, records: feedback }, null, 2) }]
        };
      }
    );

  // F-23: トークン推定ベースのコスト見積
  govTool(
    "estimate_prompt_cost",
    {
      title: "Prompt コスト見積",
      description: "Prompt のトークン数とモデルレート から推定コストを計算します。",
      inputSchema: {
        prompt: z.string().min(1),
        modelName: z.string().optional().describe("使用 LLM モデル (既定: mistral)"),
        outputTokenEstimate: z.number().optional().describe("出力トークン予測 (既定: 入力の 0.3 倍)")
      }
    },
    async ({ prompt, modelName, outputTokenEstimate }: { prompt: string; modelName?: string; outputTokenEstimate?: number }) => {
      // deps から受け取った evaluatePromptMetrics を使用
      const rawMetrics = evaluatePromptMetrics(prompt);
      // deps の返却型は PromptMetrics のサブセット。costEstimate 計算に必要なフィールドのみ使用
      const metrics = {
        estimatedTokens: rawMetrics.estimatedTokens,
        lengthChars: 0,
        lineCount: 0,
        containsProjectContext: rawMetrics.containsProjectContext,
        containsAgentsSection: rawMetrics.containsAgentsSection,
        containsSkillsSection: rawMetrics.containsSkillsSection,
        containsTaskSection: rawMetrics.containsTaskSection,
        matchedSkillCount: 0,
        totalSkillCount: 0,
        matchedTriggerCount: 0,
        totalTriggerCount: 0,
        skillCoverageRate: rawMetrics.skillCoverageRate,
        triggerMatchRate: rawMetrics.triggerMatchRate
      };
      const costEstimate = estimatePromptCost(metrics, modelName ?? "mistral", outputTokenEstimate);
      return {
        content: [{ type: "text", text: JSON.stringify(costEstimate, null, 2) }]
      };
    }
  );
}

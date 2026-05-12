import type { SystemEventLogStatus, SystemEventRecord } from "../../../event/system-event-manager.js";
import type { GovernanceState } from "../../../governance/governance-state.js";
import type { HandlersDashboardState } from "../../../types/index.js";
import type { MetricsSummary } from "../../../../tools/metrics.js";
import { getMetricsSummary } from "../../../../tools/metrics.js";
import { getActiveTraces, getCompletedTraces } from "../../../trace/trace-context.js";
import { duplicateEntries } from "./analytics-formatters.js";
import {
  aggregateToolAfterExecuteEvents,
  type ToolExecutionAggregate
} from "./analytics-event-insights.js";

export function buildHealthCheckGovernanceDiagnostics(governanceState: GovernanceState): {
  governanceValidation: Record<string, unknown>;
  governanceWarnings: string[];
} {
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
    governanceValidation,
    governanceWarnings
  };
}

export function buildHealthCheckJsonPayload(args: {
  checkedAt: string;
  toolAfterEventsCount: number;
  aggregate: ToolExecutionAggregate;
  governanceState: GovernanceState;
  governanceValidation: Record<string, unknown>;
  governanceWarnings: string[];
  activeTracesCount: number;
  recentCompletedTraces: unknown[];
  metricsSummary: MetricsSummary;
  eventLogs: SystemEventLogStatus;
  dashboard: HandlersDashboardState;
}): Record<string, unknown> {
  return {
    status: "ok",
    checkedAt: args.checkedAt,
    toolExecutions: {
      sampled: args.toolAfterEventsCount,
      totals: args.aggregate.totals,
      rates: args.aggregate.rates
    },
    disabledResources: {
      skills: args.governanceState.disabled.skills.length,
      tools: args.governanceState.disabled.tools.length,
      presets: args.governanceState.disabled.presets.length
    },
    governanceValidation: args.governanceValidation,
    governanceWarnings: args.governanceWarnings,
    traces: {
      activeCount: args.activeTracesCount,
      recentCompletedCount: args.recentCompletedTraces.length,
      recentCompleted: args.recentCompletedTraces.slice(0, 10)
    },
    metrics: {
      totalCalls: args.metricsSummary.totalCalls,
      totalErrors: args.metricsSummary.totalErrors,
      overallSuccessRate: args.metricsSummary.overallSuccessRate,
      overallAvgDurationMs: args.metricsSummary.overallAvgDurationMs,
      topTools: args.metricsSummary.perTool.slice(0, 10)
    },
    eventLogs: args.eventLogs,
    handlers: args.dashboard
  };
}

export function buildHealthCheckMarkdown(args: {
  checkedAt: string;
  toolAfterEventsCount: number;
  successRate: number;
  failureRate: number;
  disabledSkillsCount: number;
  disabledToolsCount: number;
  disabledPresetsCount: number;
  activeTracesCount: number;
  recentCompletedTracesCount: number;
  totalCalls: number;
  totalErrors: number;
  overallSuccessRate: number;
  overallAvgDurationMs: number;
  governanceWarnings: string[];
}): string {
  return [
    "## Health Check",
    "",
    "| 指標 | 値 |",
    "|------|-----|",
    `| チェック日時 | ${args.checkedAt} |`,
    `| ツール実行 (サンプル) | ${args.toolAfterEventsCount} |`,
    `| 成功率 | ${args.successRate}% |`,
    `| 失敗率 | ${args.failureRate}% |`,
    `| 無効化スキル | ${args.disabledSkillsCount} |`,
    `| 無効化ツール | ${args.disabledToolsCount} |`,
    `| 無効化プリセット | ${args.disabledPresetsCount} |`,
    `| アクティブトレース | ${args.activeTracesCount} |`,
    `| 完了トレース (直近) | ${args.recentCompletedTracesCount} |`,
    `| 総コール数 | ${args.totalCalls} |`,
    `| 総エラー数 | ${args.totalErrors} |`,
    `| 全体成功率 | ${args.overallSuccessRate} |`,
    `| 平均実行時間 | ${args.overallAvgDurationMs}ms |`,
    ...(args.governanceWarnings.length > 0 ? ["", "### ⚠️ ガバナンス警告", ...args.governanceWarnings.map((w) => `- ${w}`)] : [])
  ].join("\n");
}

export async function executeHealthCheckTool(args: {
  systemEventLimit?: number;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
  getSystemEventLogStatus: () => Promise<SystemEventLogStatus>;
}): Promise<{ jsonPayload: Record<string, unknown>; markdown: string }> {
  const eventLimit = args.systemEventLimit ?? 100;
  const toolAfterEvents = await args.loadSystemEvents(eventLimit, "tool_after_execute");
  const aggregate = aggregateToolAfterExecuteEvents(toolAfterEvents);
  const governanceState = await args.loadGovernanceState();
  const dashboard = args.generateHandlersDashboard(args.handlersState);
  const eventLogs = await args.getSystemEventLogStatus();
  const activeTraces = getActiveTraces();
  const recentCompletedTraces = getCompletedTraces(100);
  const metricsSummary = getMetricsSummary();
  const checkedAt = new Date().toISOString();
  const { governanceValidation, governanceWarnings } = buildHealthCheckGovernanceDiagnostics(governanceState);

  const jsonPayload = buildHealthCheckJsonPayload({
    checkedAt,
    toolAfterEventsCount: toolAfterEvents.length,
    aggregate,
    governanceState,
    governanceValidation,
    governanceWarnings,
    activeTracesCount: activeTraces.length,
    recentCompletedTraces,
    metricsSummary,
    eventLogs,
    dashboard
  });

  const markdown = buildHealthCheckMarkdown({
    checkedAt,
    toolAfterEventsCount: toolAfterEvents.length,
    successRate: aggregate.rates.successRate,
    failureRate: aggregate.rates.failureRate,
    disabledSkillsCount: governanceState.disabled.skills.length,
    disabledToolsCount: governanceState.disabled.tools.length,
    disabledPresetsCount: governanceState.disabled.presets.length,
    activeTracesCount: activeTraces.length,
    recentCompletedTracesCount: recentCompletedTraces.length,
    totalCalls: metricsSummary.totalCalls,
    totalErrors: metricsSummary.totalErrors,
    overallSuccessRate: metricsSummary.overallSuccessRate,
    overallAvgDurationMs: metricsSummary.overallAvgDurationMs,
    governanceWarnings
  });

  return {
    jsonPayload,
    markdown
  };
}
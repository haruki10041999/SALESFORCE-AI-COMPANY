import { promises as fsPromises } from "fs";
import { dirname, resolve, join } from "path";
import { z } from "zod";
import { getPrimaryDatabaseUrl } from "../core/config/runtime-config.js";
import type { GovernanceState } from "../core/governance/governance-state.js";
import type { SystemEventRecord, SystemEventLogStatus } from "../core/event/system-event-manager.js";
import type { AgentMessage, ChatSession, HandlersDashboardState, ExportStatistics } from "../core/types/index.js";
import { getActiveTraces, getCompletedTraces } from "../core/trace/trace-context.js";
import { defineKnowledgeGraphDashboardTool } from "./analytics/knowledge-graph-dashboard.js";
import { defineAgentAbTestTool } from "./analytics/agent-ab-test.js";
import { defineHealthCheckTool } from "./analytics/health-check.js";
import { defineAnalyzeChatTrendsTool } from "./analytics/analyze-chat-trends.js";
import { defineGetToolExecutionStatisticsTool } from "./analytics/get-tool-execution-statistics.js";
import { defineGetHandlersDashboardTool } from "./analytics/get-handlers-dashboard.js";
import { defineExportHandlersStatisticsTool } from "./analytics/export-handlers-statistics.js";
import { defineObservabilityDashboardTool } from "./analytics/observability-dashboard.js";
import { defineSynergyRecommendComboTool } from "./analytics/synergy-recommend-combo.js";
import { defineScoreAgentSynergyTool } from "./analytics/score-agent-synergy.js";
import { defineDrillDownDashboardTool } from "./analytics/drill-down-dashboard.js";
import { defineTuneTriggerRulesTool } from "./analytics/tune-trigger-rules.js";
import { defineEvaluateCostSlaTool } from "./analytics/evaluate-cost-sla.js";
import { defineAnalyzeAbTestHistoryTool } from "./analytics/analyze-ab-test-history.js";
import { defineLinUcbRankArmsTool } from "./analytics/linucb-rank-arms.js";
import { defineUpdateAgentReputationTool } from "./analytics/update-agent-reputation.js";
import { defineGetAgentReputationTool } from "./analytics/get-agent-reputation.js";
import { defineRateToolExecutionTool } from "./analytics/rate-tool-execution.js";
import { defineRecordUserFeedbackTool } from "./analytics/record-user-feedback.js";
import { defineGetFeedbackMetricsTool } from "./analytics/get-feedback-metrics.js";
import { defineGetSessionFeedbackTool } from "./analytics/get-session-feedback.js";
import { defineEstimatePromptCostTool } from "./analytics/estimate-prompt-cost.js";
import type { RegisterGovToolDeps } from "./types.js";
import type { PolicySnapshotManager } from "../core/learning/policy-snapshot.js";
import { OutputsArtifactWriter } from "../core/persistence/outputs-artifact-writer.js";
import { computeFeedbackMetrics, loadFeedbackForSession } from "../core/learning/feedback-manager.js";

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
  /** T-07: optional – when provided, scheduleRefresh on feedback writes */
  policySnapshotManager?: PolicySnapshotManager;
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
    outputsDir,
    policySnapshotManager
  } = deps;

  const artifactWriter = new OutputsArtifactWriter({
    outputsDir,
    databaseUrl: getPrimaryDatabaseUrl()
  });

  const agentReputationFile = resolve(outputsDir, "agent-reputation.jsonl");
  const outputRatioFeedbackFile = resolve(outputsDir, "output-ratio.jsonl");

  // Register all analytics tools using split factory functions (18 tools)
  defineKnowledgeGraphDashboardTool({ govTool, outputsDir });
  defineAgentAbTestTool({ govTool, runChatTool, evaluatePromptMetrics, outputsDir });
  defineHealthCheckTool({ govTool, loadSystemEvents, loadGovernanceState, generateHandlersDashboard, handlersState, getSystemEventLogStatus });
  defineAnalyzeChatTrendsTool({ govTool, agentLog, loadChatHistories });
  defineGetToolExecutionStatisticsTool({ govTool, loadSystemEvents, loadGovernanceState });
  defineGetHandlersDashboardTool({ govTool, generateHandlersDashboard, handlersState });
  defineExportHandlersStatisticsTool({ govTool, handlersState, exportStatisticsAsCsv, exportStatisticsAsJson, ensureDir });
  defineObservabilityDashboardTool({ govTool, outputsDir, loadSystemEvents, loadGovernanceState, artifactWriter });
  defineSynergyRecommendComboTool({ govTool });
  defineScoreAgentSynergyTool({ govTool, loadChatHistories });
  defineDrillDownDashboardTool({ govTool, loadSystemEvents });
  defineTuneTriggerRulesTool({ govTool, outputsDir, loadSystemEvents, ensureDir, artifactWriter });
  defineEvaluateCostSlaTool({ govTool, evaluatePromptMetrics, outputsDir });
  defineAnalyzeAbTestHistoryTool({ govTool, outputsDir, artifactWriter });
  defineLinUcbRankArmsTool({ govTool });
  defineUpdateAgentReputationTool({ govTool, agentReputationFile });
  defineGetAgentReputationTool({ govTool, agentReputationFile });
  defineRateToolExecutionTool({ govTool, policySnapshotManager });
  defineRecordUserFeedbackTool({ govTool, policySnapshotManager });
  defineGetFeedbackMetricsTool({ govTool, computeFeedbackMetrics });
  defineGetSessionFeedbackTool({ govTool, loadFeedbackForSession });
  defineEstimatePromptCostTool({ govTool, evaluatePromptMetrics, outputRatioFeedbackFile, outputsDir });
}

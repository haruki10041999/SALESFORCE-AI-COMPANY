// .env を全モジュールより前に読み込む (副作用 import)。
// 注意: ESM の import は宣言順に評価されるため、必ずトップに配置すること。
import "./env-loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, promises as fsPromises } from "fs";
import { join, resolve, relative } from "path";
import { AppError } from "./core/errors/messages.js";
import { initializeServerRuntime as initializeServerRuntimeModule } from "./bootstrap.js";
import { registerServerTools } from "./tool-registry.js";
import { startMcpTransport } from "./transport.js";
import { runWithLifecycle } from "./lifecycle.js";

// ============================================================
// Core Modules
// ============================================================
import { scoreByQuery } from "./core/resource/topic-skill-ranking.js";
import {
  resolveProjectRootFromFile,
  findMdFilesRecursive,
  toPosixPath,
  truncateContent,
  listMdFiles as listMdFilesFromCatalog,
  getMdFile as getMdFileFromCatalog,
  getMdFileAsync as getMdFileAsyncFromCatalog
} from "./core/context/markdown-catalog.js";
import { createCustomToolRegistry } from "./core/resource/custom-tool-registry.js";
import {
  validateSkillCreation,
  validatePresetCreation,
  validateToolCreation
} from "./core/quality/resource-validation.js";
import { emitEvent } from "./core/event/event-dispatcher.js";
import {
  createSystemEventManager,
  summarizeValue,
  type SystemEventRecord,
  type SystemEventName
} from "./core/event/system-event-manager.js";

// ============================================================
// Phase 5: Handlers Auto-Initialization
// ============================================================
import {
  initializeHandlersState,
  autoInitializeHandlers,
  generateHandlersDashboard,
  type HandlersState
} from "./handlers/auto-init.js";

// ============================================================
// Memory / Prompt-Engine / Statistics
// ============================================================
import { addMemory, searchMemory, listMemory, clearMemory } from "../memory/project-memory.js";
import { addRecord, searchByKeyword, searchByKeywordAsync } from "../memory/vector-store.js";
import { buildPrompt } from "../prompt-engine/prompt-builder.js";
import { evaluatePromptMetrics } from "../prompt-engine/prompt-evaluator.js";
import {
  exportStatisticsAsCsv,
  exportStatisticsAsJson,
  type HandlersStatistics
} from "./handlers/statistics-manager.js";
import {
  checkDailyLimitExceeded
} from "./core/governance/governance-manager.js";
import { createOperationLog } from "./core/governance/operation-log.js";
import { createGovernedToolRegistrar } from "./core/governance/governed-tool-registrar.js";
import { createGovernanceEventAutomationManager } from "./core/governance/governance-event-automation.js";
import { createDisabledResourceFilter } from "./core/governance/disabled-resource-filter.js";
import { createDisabledToolsCacheManager } from "./core/governance/disabled-tools-cache.js";
import { createGovernanceStateManager } from "./core/governance/governance-state-manager.js";
import {
  type GovernedResourceType,
  type GovernanceState
} from "./core/governance/governance-state.js";
import { createPresetStore } from "./core/context/preset-store.js";
import type { ChatPreset as StoredChatPreset } from "./core/context/preset-store.js";
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";
import { createHistoryStore } from "./core/context/history-store.js";
import { createOrchestrationSessionStore } from "./core/context/orchestration-session-store.js";
import { createPromptRenderer } from "./core/context/prompt-rendering.js";
import { DEFAULT_SQLITE_STATE_FILE } from "./core/persistence/sqlite-store.js";
import type { CustomToolDefinition as RegistryCustomToolDefinition } from "./core/resource/custom-tool-registry.js";
import { evaluatePseudoHooks as evaluatePseudoHooksCore } from "./core/orchestration/pseudo-hooks.js";
import { createChatToolRunner, generateSessionId } from "./core/orchestration/chat-tool-runner.js";
import { orchestrationSessions, clearOrchestrationSessionsForTest } from "./core/orchestration/session-registry.js";
import { chatInputSchema, triggerRuleSchema } from "./core/orchestration/schemas.js";
import type { OrchestrationSession } from "./core/types/index.js";
import type { SystemEventType } from "./core/event/event-dispatcher.js";
import { createLogger } from "./core/logging/logger.js";
import { getLowRelevanceScoreThreshold } from "./core/config/runtime-config.js";

// Resolve project root from this file location so cross-repo clients can share one server.
const ROOT = resolveProjectRootFromFile(import.meta.url);
const OUTPUTS_DIR = process.env.SF_AI_OUTPUTS_DIR
  ? resolve(process.env.SF_AI_OUTPUTS_DIR)
  : join(ROOT, "outputs");
const logger = createLogger("Server");

function listMdFiles(dir: string): { name: string; summary: string }[] {
  return listMdFilesFromCatalog(ROOT, dir);
}

function getMdFile(dir: string, name: string): string {
  return getMdFileFromCatalog(ROOT, dir, name);
}

function getMdFileAsync(dir: string, name: string): Promise<string> {
  return getMdFileAsyncFromCatalog(ROOT, dir, name);
}

function truncateContentCompat(text: string, maxChars: number, label?: string): string {
  return truncateContent(text, maxChars, label ?? "");
}

// TASK-F2: prompt rendering wired through a single facade so server.ts stays
// focused on tool registration and lifecycle, not prompt composition details.
const { buildChatPrompt, buildChatPromptCompat } = createPromptRenderer({
  root: ROOT,
  findMdFilesRecursive,
  toPosixPath,
  truncateContent: truncateContentCompat,
  getMdFileAsync
});

function isCoreBridgeableEvent(event: SystemEventName): event is Extract<SystemEventName, SystemEventType> {
  return event === "error_aggregate_detected" || event === "governance_threshold_exceeded";
}

async function emitSystemEventCompat(event: string, payload: Record<string, unknown>): Promise<void> {
  await emitSystemEvent(event as SystemEventName, payload);
}

async function loadSystemEventsCompat(limit?: number, event?: string): Promise<SystemEventRecord[]> {
  return loadSystemEvents(limit, event as SystemEventName | undefined);
}

// エージェントメッセージログ
interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

const agentLog: AgentMessage[] = [];
const handlersState = initializeHandlersState();
const OPERATIONS_LOG_FILE = join(OUTPUTS_DIR, "operations-log.jsonl");
const { loadRecentOperations, appendOperationLog } = createOperationLog({ logFile: OPERATIONS_LOG_FILE, ensureDir });
const LOW_RELEVANCE_SCORE_THRESHOLD = getLowRelevanceScoreThreshold();
const DEFAULT_PROTECTED_TOOLS = [
  "apply_resource_actions",
  "get_resource_governance",
  "review_resource_governance",
  "record_resource_signal",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config"
];
const GOVERNANCE_FILE = join(OUTPUTS_DIR, "resource-governance.json");
const TOOL_PROPOSALS_DIR = join(OUTPUTS_DIR, "tool-proposals");
const CUSTOM_TOOLS_DIR = join(OUTPUTS_DIR, "custom-tools");
const governanceStateManager = createGovernanceStateManager({
  defaultProtectedTools: DEFAULT_PROTECTED_TOOLS,
  governanceFile: GOVERNANCE_FILE,
  ensureDir
});
const buildDefaultGovernanceState = () => governanceStateManager.buildDefaultGovernanceState();
const loadGovernanceState = () => governanceStateManager.loadGovernanceState();
const saveGovernanceState = (state: GovernanceState) => governanceStateManager.saveGovernanceState(state);
const normalizeDisabledEntries = (names: string[]) => governanceStateManager.normalizeDisabledEntries(names);
const normalizeProtectedTools = (names: string[]) => governanceStateManager.normalizeProtectedTools(names);

const { emitSystemEvent, loadSystemEvents, registerToolFailure, getSystemEventLogStatus } = createSystemEventManager({
  rootDir: ROOT,
  outputsDir: OUTPUTS_DIR,
  ensureDir,
  applyEventAutomation,
  bridgeCoreEvent: async (event: SystemEventName, timestamp: string, payload: Record<string, unknown>) => {
    if (isCoreBridgeableEvent(event)) {
      await emitEvent({
        type: event,
        timestamp,
        payload
      });
    }
  }
});

const server = new McpServer({
  name: "salesforce-ai-company",
  version: "1.0.0"
});

type RegisteredToolHandler = (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

const registeredToolHandlers = new Map<string, RegisteredToolHandler>();
const registeredToolMetadata = new Map<string, { title?: string; description?: string; tags?: string[] }>();
const registerToolOriginal = server.registerTool.bind(server);

(server as unknown as {
  registerTool: typeof server.registerTool;
}).registerTool = ((
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: Parameters<typeof server.registerTool>[2]
) => {
  registeredToolHandlers.set(name, handler as RegisteredToolHandler);
  registeredToolMetadata.set(name, {
    title: (config as { title?: string })?.title,
    description: (config as { description?: string })?.description,
    tags: (config as { tags?: string[] })?.tags
  });
  return registerToolOriginal(name, config, handler);
}) as typeof server.registerTool;

export function listRegisteredToolNamesForTest(): string[] {
  return [...registeredToolHandlers.keys()].sort();
}

export async function invokeRegisteredToolForTest(name: string, input: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
  const handler = registeredToolHandlers.get(name);
  if (!handler) {
    // TASK-F8: localized error with stable code for downstream classification.
    throw new AppError("TOOL_NOT_FOUND", { name });
  }
  return handler(input);
}

export { clearOrchestrationSessionsForTest };

// ============================================================
// ガバナンス対応ツール登録ラッパー（disable チェック付き）
// ============================================================

const disabledToolsCache = createDisabledToolsCacheManager({
  governanceFilePath: join(OUTPUTS_DIR, "resource-governance.json"),
  logger,
  loadGovernanceState,
  normalizeResourceName
});

const { govTool } = createGovernedToolRegistrar({
  registerTool: (name, config, handler) => {
    server.registerTool(
      name,
      config as Parameters<typeof server.registerTool>[1],
      handler as Parameters<typeof server.registerTool>[2]
    );
  },
  isToolDisabled: (toolName: string) => {
    return disabledToolsCache.isToolDisabled(toolName);
  },
  normalizeResourceName,
  outputsDir: OUTPUTS_DIR,
  serverRoot: ROOT,
  emitSystemEvent: emitSystemEventCompat,
  summarizeValue,
  registerToolFailure,
  getRetryConfig: async () => {
    const state = await loadGovernanceState();
    return state.config.toolExecution;
  }
});



const disabledResourceFilter = createDisabledResourceFilter({
  loadGovernanceState,
  toPosixPath
});

function normalizeResourceName(name: string): string {
  return disabledResourceFilter.normalizeResourceName(name);
}

async function getDisabledResourceSet(resourceType: GovernedResourceType): Promise<Set<string>> {
  return disabledResourceFilter.getDisabledResourceSet(resourceType);
}

async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
  return disabledResourceFilter.filterDisabledSkills(skillNames);
}

async function isPresetDisabled(presetName: string): Promise<boolean> {
  return disabledResourceFilter.isPresetDisabled(presetName);
}

const runChatTool = createChatToolRunner({
  listSkills: () => listMdFiles("skills"),
  filterDisabledSkills,
  emitSystemEvent: emitSystemEventCompat,
  buildChatPrompt
});

const HISTORY_DIR = join(OUTPUTS_DIR, "history");
const STATE_DB_PATH = process.env.SF_AI_STATE_DB_PATH
  ? resolve(process.env.SF_AI_STATE_DB_PATH)
  : join(OUTPUTS_DIR, DEFAULT_SQLITE_STATE_FILE);
const USE_SQLITE_HISTORY = (process.env.SF_AI_HISTORY_SQLITE ?? "false").toLowerCase() === "true";
const PRESETS_DIR = join(OUTPUTS_DIR, "presets");
const SESSIONS_DIR = join(OUTPUTS_DIR, "sessions");
const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_FILES = 200;
const SESSION_RETENTION_DAYS = 30;
const SESSION_MAX_FILES = 200;

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

const { createPreset, listPresetsData, getPreset } = createPresetStore({ presetsDir: PRESETS_DIR, ensureDir });
const { saveChatHistory, saveSessionHistory, loadChatHistories, restoreChatHistory } = createHistoryStore({
  historyDir: HISTORY_DIR,
  ensureDir,
  agentLog,
  maxHistoryFiles: HISTORY_MAX_FILES,
  retentionDays: HISTORY_RETENTION_DAYS,
  sqlite: {
    enabled: USE_SQLITE_HISTORY,
    dbPath: STATE_DB_PATH
  }
});
const { saveOrchestrationSession, restoreOrchestrationSession } = createOrchestrationSessionStore<OrchestrationSession>({
  sessionsDir: SESSIONS_DIR,
  ensureDir,
  getSession: (sessionId: string) => orchestrationSessions.get(sessionId),
  setSession: (session: OrchestrationSession) => {
    orchestrationSessions.set(session.id, session);
  },
  toRelativePosixPath: (absoluteFilePath: string) => toPosixPath(relative(ROOT, absoluteFilePath)),
  maxSessionFiles: SESSION_MAX_FILES,
  retentionDays: SESSION_RETENTION_DAYS
});

const { loadedCustomToolNames, registerCustomTool, unregisterCustomTool, loadCustomToolsFromDir } = createCustomToolRegistry({
  govTool,
  filterDisabledSkills,
  buildChatPrompt: buildChatPromptCompat
});

const BUILTIN_TOOL_CATALOG = [
  "repo_analyze",
  "apex_analyze",
  "lwc_analyze",
  "deploy_org",
  "run_tests",
  "run_deployment_verification",
  "compare_org_metadata",
  "flow_condition_simulate",
  "suggest_flow_test_cases",
  "permission_set_diff",
  "recommend_permission_sets",
  "apex_dependency_graph",
  "branch_diff_summary",
  "branch_diff_to_prompt",
  "pr_readiness_check",
  "security_delta_scan",
  "deployment_impact_summary",
  "changed_tests_suggest",
  "list_agents",
  "get_agent",
  "list_skills",
  "get_skill",
  "list_personas",
  "chat",
  "simulate_chat",
  "orchestrate_chat",
  "evaluate_triggers",
  "dequeue_next_agent",
  "get_orchestration_session",
  "save_orchestration_session",
  "restore_orchestration_session",
  "list_orchestration_sessions",
  "record_agent_message",
  "record_reasoning_step",
  "get_trace_reasoning",
  "get_agent_log",
  "parse_and_record_chat",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config",
  "save_chat_history",
  "load_chat_history",
  "restore_chat_history",
  "create_preset",
  "list_presets",
  "run_preset",
  "search_resources",
  "auto_select_resources",
  "record_skill_rating",
  "get_skill_rating_report",
  "agent_ab_test",
  "analyze_ab_test_history",
  "tune_trigger_rules",
  "evaluate_cost_sla",
  "record_user_feedback",
  "get_feedback_metrics",
  "get_session_feedback",
  "estimate_prompt_cost",
  "proposal_feedback_learn",
  "smart_chat",
  "analyze_chat_trends",
  "health_check",
  "get_tool_execution_statistics",
  "get_handlers_dashboard",
  "export_handlers_statistics",
  "export_to_markdown",
  "batch_chat",
  "add_memory",
  "search_memory",
  "list_memory",
  "clear_memory",
  "add_vector_record",
  "search_vector",
  "build_prompt",
  "evaluate_prompt_metrics",
  "evaluate_quality_rubric",
  "get_context"
];

const { listSkillsCatalog, listPresetsCatalog, listToolsCatalog, resourceScore, getCatalogCounts } = createCatalogHelpers({
  skillsDir: join(ROOT, "skills"),
  findMdFilesRecursive,
  toPosixPath,
  relative,
  listPresetsData,
  builtinToolCatalog: BUILTIN_TOOL_CATALOG,
  loadedCustomToolNames
});

const governanceEventAutomation = createGovernanceEventAutomationManager({
  loadGovernanceState,
  saveGovernanceState,
  normalizeResourceName,
  normalizeDisabledEntries,
  normalizeProtectedTools,
  refreshDisabledToolsCache: () => disabledToolsCache.refresh("event-automation"),
  getDefaultEventAutomationConfig: () => buildDefaultGovernanceState().config.eventAutomation,
  summarizeError: summarizeValue
});

async function setToolDisabledState(toolName: string, disabled: boolean): Promise<{ changed: boolean; disabledTools: string[] }> {
  return governanceEventAutomation.setToolDisabledState(toolName, disabled);
}

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  await governanceEventAutomation.applyEventAutomation(event, payload);
}

/**
 * リソース作成時の検証関数
 * 品質チェック、重複排除、ガバナンス確認を統合
 */
async function validateAndCreateSkillWithQuality(
  skillName: string,
  skillContent: string,
  state: GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingSkills = await listSkillsCatalog();
  return validateSkillCreation(skillName, skillContent, existingSkills);
}

/**
 * プリセット作成時の検証関数
 */
async function validateAndCreatePresetWithQuality(
  presetName: string,
  presetData: {
    description: string;
    agents: string[];
    topic: string;
  },
  state: GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingPresets = await listPresetsCatalog();
  return validatePresetCreation(presetName, presetData, existingPresets);
}

/**
 * ツール作成時の検証関数
 */
async function validateAndCreateToolWithQuality(
  toolName: string,
  toolDescription: string,
  state: GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingTools = listToolsCatalog(state);
  return validateToolCreation(toolName, toolDescription, existingTools);
}

registerServerTools({
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent: emitSystemEventCompat,
    buildChatPrompt: buildChatPromptCompat,
    evaluatePseudoHooks: evaluatePseudoHooksCore,
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    root: ROOT,
    agentLog,
    loadSystemEvents: loadSystemEventsCompat,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    listMdFiles,
    getMdFile,
    listPresetsData,
    scoreByQuery,
    lowRelevanceScoreThreshold: LOW_RELEVANCE_SCORE_THRESHOLD,
    registeredToolMetadata,
    createPreset,
    getPreset,
    isPresetDisabled,
    getSystemEventLogStatus,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory,
    findMdFilesRecursive,
    toPosixPath,
    addRecord,
    searchByKeyword,
    searchByKeywordAsync,
    buildPrompt,
    evaluatePromptMetrics,
    presetsDir: PRESETS_DIR,
    toolProposalsDir: TOOL_PROPOSALS_DIR,
    customToolsDir: CUSTOM_TOOLS_DIR,
    governanceFile: GOVERNANCE_FILE,
    loadRecentOperations,
    checkDailyLimitExceeded,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache: () => disabledToolsCache.refresh("tool-call"),
    appendOperationLog,
    emitEvent,
    resourceScore
  });

async function main(): Promise<void> {
  await initializeServerRuntimeModule({
    logger,
    customToolsDir: CUSTOM_TOOLS_DIR,
    handlersState,
    loadCustomToolsFromDir,
    refreshDisabledToolsCache: (reason?: string) => disabledToolsCache.refresh(reason ?? "manual"),
    startDisabledToolsCacheSync: () => disabledToolsCache.startSync(),
    resetDisabledToolsCache: () => disabledToolsCache.resetCache(),
    autoInitializeHandlers
  });

  await startMcpTransport(server, logger);
}

runWithLifecycle({
  importMetaUrl: import.meta.url,
  argvPath: process.argv[1],
  logger,
  start: main
});


import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, promises as fsPromises, watch, type FSWatcher } from "fs";
import { basename, dirname, join, resolve, relative } from "path";
import { pathToFileURL } from "url";

// ============================================================
// Core Modules
// ============================================================
import { rankSkillNamesByTopic, scoreByQuery } from "./core/resource/topic-skill-ranking.js";
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
import { registerAllTools as registerAllToolsModule } from "./core/registration/register-all-tools.js";
import { buildRegisterAllToolsDeps } from "./core/registration/register-all-tools-deps.js";

// ============================================================
// Memory / Prompt-Engine / Statistics
// ============================================================
import { addMemory, searchMemory, listMemory, clearMemory } from "../memory/project-memory.js";
import { addRecord, searchByKeyword } from "../memory/vector-store.js";
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
import {
  normalizeDisabledEntries as _normalizeDisabledEntries,
  normalizeProtectedTools as _normalizeProtectedTools,
  buildDefaultGovernanceState as _buildDefaultGovernanceState,
  loadGovernanceState as _loadGovernanceState,
  saveGovernanceState as _saveGovernanceState,
  type GovernedResourceType,
  type GovernanceState
} from "./core/governance/governance-state.js";
import { createPresetStore } from "./core/context/preset-store.js";
import type { ChatPreset as StoredChatPreset } from "./core/context/preset-store.js";
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";
import { createHistoryStore } from "./core/context/history-store.js";
import { createOrchestrationSessionStore } from "./core/context/orchestration-session-store.js";
import { buildChatPromptFromContext } from "./core/context/chat-prompt-builder.js";
import type { CustomToolDefinition as RegistryCustomToolDefinition } from "./core/resource/custom-tool-registry.js";
import {
  buildRuleKey as _buildRuleKey,
  evaluatePseudoHooks as _evaluatePseudoHooks
} from "./core/orchestration/pseudo-hooks.js";
import type { SystemEventType } from "./core/event/event-dispatcher.js";
import { createLogger } from "./core/logging/logger.js";

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

async function buildChatPrompt(
  topic: string,
  agentNames: string[],
  personaName: string | undefined,
  skillNames: string[],
  filePaths: string[],
  turns: number,
  maxContextChars?: number,
  appendInstruction?: string,
  includeProjectContext?: boolean
): Promise<string> {
  return buildChatPromptFromContext(
    {
      topic,
      agentNames,
      personaName,
      skillNames,
      filePaths,
      turns,
      maxContextChars,
      appendInstruction,
      includeProjectContext
    },
    {
      root: ROOT,
      findMdFilesRecursive,
      toPosixPath,
      truncateContent: truncateContentCompat,
      getMdFileAsync
    }
  );
}

async function buildChatPromptCompat(
  topic: string,
  agentNames: string[],
  personaName?: string,
  skillNames?: string[],
  filePaths?: string[],
  turns?: number,
  maxContextChars?: number,
  appendInstruction?: string,
  includeProjectContext?: boolean
): Promise<string> {
  return buildChatPrompt(
    topic,
    agentNames,
    personaName,
    skillNames ?? [],
    filePaths ?? [],
    turns ?? 6,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  );
}

function truncateContentCompat(text: string, maxChars: number, label?: string): string {
  return truncateContent(text, maxChars, label ?? "");
}

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
const LOW_RELEVANCE_SCORE_THRESHOLD = 6;
const DEFAULT_PROTECTED_TOOLS = [
  "apply_resource_actions",
  "get_resource_governance",
  "review_resource_governance",
  "record_resource_signal",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config"
];
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
    throw new Error(`Tool not found: ${name}`);
  }
  return handler(input);
}

export function clearOrchestrationSessionsForTest(): void {
  orchestrationSessions.clear();
}

// ============================================================
// ガバナンス対応ツール登録ラッパー（disable チェック付き）
// ============================================================

let cachedDisabledTools: Set<string> = new Set();
let disabledToolsCacheLastRefreshAt = 0;
let refreshDisabledToolsCacheInFlight: Promise<void> | null = null;
let governanceWatcher: FSWatcher | null = null;
let disabledToolsCacheRefreshInterval: NodeJS.Timeout | null = null;

const DISABLED_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const DISABLED_CACHE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

function triggerRefreshDisabledToolsCache(reason: string): void {
  if (!refreshDisabledToolsCacheInFlight) {
    refreshDisabledToolsCacheInFlight = refreshDisabledToolsCache()
      .catch((error) => {
        logger.warn(`Disabled tools cache refresh failed (${reason})`, error);
      })
      .finally(() => {
        refreshDisabledToolsCacheInFlight = null;
      });
  }
}

function maybeRefreshDisabledToolsCache(reason: string): void {
  const isStale = Date.now() - disabledToolsCacheLastRefreshAt > DISABLED_CACHE_MAX_AGE_MS;
  if (isStale) {
    triggerRefreshDisabledToolsCache(reason);
  }
}

function startDisabledToolsCacheSync(governanceFilePath: string): void {
  if (!disabledToolsCacheRefreshInterval) {
    disabledToolsCacheRefreshInterval = setInterval(() => {
      triggerRefreshDisabledToolsCache("interval");
    }, DISABLED_CACHE_REFRESH_INTERVAL_MS);
    disabledToolsCacheRefreshInterval.unref?.();
  }

  if (!governanceWatcher) {
    const watchedDir = dirname(governanceFilePath);
    const watchedFile = basename(governanceFilePath);
    governanceWatcher = watch(watchedDir, (_eventType, fileName) => {
      if (!fileName || fileName.toString() !== watchedFile) {
        return;
      }
      triggerRefreshDisabledToolsCache("fs-watch");
    });
    governanceWatcher.on("error", (error) => {
      logger.warn("Governance file watcher error", error);
    });
    governanceWatcher.unref?.();
  }
}

async function refreshDisabledToolsCache(): Promise<void> {
  try {
    const state = await loadGovernanceState();
    cachedDisabledTools = new Set((state.disabled.tools ?? []).map((name: string) => normalizeResourceName(name)));
    disabledToolsCacheLastRefreshAt = Date.now();
  } catch {
    cachedDisabledTools = new Set();
    disabledToolsCacheLastRefreshAt = Date.now();
  }
}

const { govTool } = createGovernedToolRegistrar({
  registerTool: (name, config, handler) => {
    server.registerTool(
      name,
      config as Parameters<typeof server.registerTool>[1],
      handler as Parameters<typeof server.registerTool>[2]
    );
  },
  isToolDisabled: (toolName: string) => {
    maybeRefreshDisabledToolsCache("on-check");
    return cachedDisabledTools.has(toolName);
  },
  normalizeResourceName,
  emitSystemEvent: emitSystemEventCompat,
  summarizeValue,
  registerToolFailure,
  getRetryConfig: async () => {
    const state = await loadGovernanceState();
    return state.config.toolExecution;
  }
});

async function suggestSkillsFromTopic(topic: string, limit = 3): Promise<string[]> {
  const skills = listMdFiles("skills");
  return rankSkillNamesByTopic(topic, skills, limit);
}

const chatInputSchema = {
  topic: z.string(),
  filePaths: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  persona: z.string().optional(),
  skills: z.array(z.string()).optional(),
  turns: z.number().int().min(1).max(30).optional(),
  maxContextChars: z.number().int().min(500).max(200000).optional(),
  appendInstruction: z.string().optional()
};

const triggerRuleSchema = z.object({
  whenAgent: z.string(),
  thenAgent: z.string(),
  messageIncludes: z.string().optional(),
  reason: z.string().optional(),
  once: z.boolean().optional()
});

type TriggerRule = z.infer<typeof triggerRuleSchema>;

interface OrchestrationSession {
  id: string;
  topic: string;
  appendInstruction?: string;
  agents: string[];
  persona?: string;
  skills: string[];
  filePaths: string[];
  turns: number;
  triggerRules: TriggerRule[];
  queue: string[];
  history: AgentMessage[];
  firedRules: string[];
}

const orchestrationSessions = new Map<string, OrchestrationSession>();

function buildRuleKey(rule: TriggerRule): string {
  return _buildRuleKey(rule);
}

function evaluatePseudoHooks(
  lastAgent: string,
  lastMessage: string,
  triggerRules: TriggerRule[],
  firedRules: string[]
): { nextAgents: string[]; fired: string[]; reasons: string[] } {
  return _evaluatePseudoHooks(lastAgent, lastMessage, triggerRules, firedRules);
}

function generateSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return "orch-" + ts;
}

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

async function runChatTool({
  topic,
  filePaths,
  agents,
  persona,
  skills,
  turns,
  maxContextChars,
  appendInstruction
}: {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
}) {
  const requestedSkills = skills ?? [];
  const autoSkills = requestedSkills.length === 0 ? await suggestSkillsFromTopic(topic, 3) : [];
  const effectiveSkills = requestedSkills.length > 0 ? requestedSkills : autoSkills;
  const { enabled: enabledSkills } = await filterDisabledSkills(effectiveSkills);

  if (requestedSkills.length === 0 && autoSkills.length === 0) {
    await emitSystemEvent("low_relevance_detected", {
      source: "chat:auto-skill-selection",
      topic,
      reason: "no skills selected from topic"
    });
  }

  const prompt = await buildChatPrompt(
    topic,
    agents ?? [],
    persona,
    enabledSkills,
    filePaths ?? [],
    turns ?? 6,
    maxContextChars,
    appendInstruction
  );

  return {
    content: [
      {
        type: "text" as const,
        text: prompt
      }
    ]
  };
}

const HISTORY_DIR = join(OUTPUTS_DIR, "history");
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
  retentionDays: HISTORY_RETENTION_DAYS
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

// ============================================================
// Resource Governance（スキル・ツール・プリセット管理）
// ============================================================

const GOVERNANCE_FILE = join(OUTPUTS_DIR, "resource-governance.json");
const TOOL_PROPOSALS_DIR = join(OUTPUTS_DIR, "tool-proposals");
const CUSTOM_TOOLS_DIR = join(OUTPUTS_DIR, "custom-tools");

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
  "compare_org_metadata",
  "flow_condition_simulate",
  "permission_set_diff",
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

function buildDefaultGovernanceState(): GovernanceState {
  return _buildDefaultGovernanceState(DEFAULT_PROTECTED_TOOLS);
}

async function loadGovernanceState(): Promise<GovernanceState> {
  return _loadGovernanceState(GOVERNANCE_FILE, ensureDir, DEFAULT_PROTECTED_TOOLS);
}

async function saveGovernanceState(state: GovernanceState): Promise<void> {
  return _saveGovernanceState(GOVERNANCE_FILE, state);
}

function normalizeDisabledEntries(names: string[]): string[] {
  return _normalizeDisabledEntries(names);
}

function normalizeProtectedTools(names: string[]): string[] {
  return _normalizeProtectedTools(names, DEFAULT_PROTECTED_TOOLS);
}

const governanceEventAutomation = createGovernanceEventAutomationManager({
  loadGovernanceState,
  saveGovernanceState,
  normalizeResourceName,
  normalizeDisabledEntries,
  normalizeProtectedTools,
  refreshDisabledToolsCache,
  getDefaultEventAutomationConfig: () => buildDefaultGovernanceState().config.eventAutomation,
  summarizeError: summarizeValue
});

async function setToolDisabledState(toolName: string, disabled: boolean): Promise<{ changed: boolean; disabledTools: string[] }> {
  return governanceEventAutomation.setToolDisabledState(toolName, disabled);
}

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  await governanceEventAutomation.applyEventAutomation(event, payload);
}

// ============================================================
// プリセットツール
// ============================================================



// ============================================================
// バッチ処理ツール
// ============================================================

// ============================================================
// Helper Functions for Resource Validation & Creation
// ============================================================

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

registerAllToolsModule(
  buildRegisterAllToolsDeps({
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent: emitSystemEventCompat,
    buildChatPrompt: buildChatPromptCompat,
    evaluatePseudoHooks,
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
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    resourceScore
  })
);

async function initializeServerRuntime(): Promise<void> {
  logger.info("Runtime initialization started");

  try {
    await loadCustomToolsFromDir(CUSTOM_TOOLS_DIR);
    logger.info("Custom tools loaded");
  } catch (error) {
    logger.warn("Failed to load custom tools. Continuing with core tools only.", error);
  }

  try {
    await refreshDisabledToolsCache();
    startDisabledToolsCacheSync(GOVERNANCE_FILE);
    logger.info("Disabled tools cache initialized");
  } catch (error) {
    cachedDisabledTools = new Set();
    logger.warn("Failed to initialize disabled tools cache. Using empty cache.", error);
  }

  try {
    autoInitializeHandlers(handlersState);
    logger.info(`Handlers auto-initialization complete (${handlersState.registeredHandlers} handlers)`);
  } catch (error) {
    logger.warn("Handler auto-initialization failed. Continuing without handlers.", error);
  }
}

async function main(): Promise<void> {
  await initializeServerRuntime();

  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    logger.info("MCP transport connected");
  } catch (error) {
    logger.error("Failed to connect MCP transport", error);
    throw error;
  }
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    logger.error("MCP server failed to start", error);
    process.exit(1);
  });
}


// @ts-nocheck
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, promises as fsPromises } from "fs";
import { join, resolve, relative } from "path";
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
import { registerCoreAnalysisTools } from "./handlers/register-core-analysis-tools.js";
import { registerBranchReviewTools } from "./handlers/register-branch-review-tools.js";
import { registerResourceCatalogTools } from "./handlers/register-resource-catalog-tools.js";
import { registerChatOrchestrationTools } from "./handlers/register-chat-orchestration-tools.js";
import { registerLoggingTools } from "./handlers/register-logging-tools.js";
import { registerHistoryTools } from "./handlers/register-history-tools.js";
import { registerResourceSearchTools } from "./handlers/register-resource-search-tools.js";
import { registerPresetTools } from "./handlers/register-preset-tools.js";
import { registerResourceGovernanceTools } from "./handlers/register-resource-governance-tools.js";
import { registerResourceActionTools } from "./handlers/register-resource-action-tools.js";
import { registerSmartChatTools } from "./handlers/register-smart-chat-tools.js";
import { registerAnalyticsTools } from "./handlers/register-analytics-tools.js";
import { registerExportTools } from "./handlers/register-export-tools.js";
import { registerMemoryTools } from "./handlers/register-memory-tools.js";
import { registerContextTools } from "./handlers/register-context-tools.js";
import { registerVectorPromptTools } from "./handlers/register-vector-prompt-tools.js";
import { registerBatchTools } from "./handlers/register-batch-tools.js";
import { registerKamilessTools } from "./handlers/register-kamiless-tools.js";

// ============================================================
// Memory / Prompt-Engine / Statistics
// ============================================================
import { addMemory, searchMemory, listMemory, clearMemory } from "../memory/project-memory.js";
import { addRecord, searchByKeyword } from "../memory/vector-store.js";
import { buildPrompt } from "../prompt-engine/prompt-builder.js";
import {
  exportStatisticsAsCsv,
  exportStatisticsAsJson
} from "./handlers/statistics-manager.js";
import {
  checkDailyLimitExceeded,
  type ResourceOperation
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
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";
import { createHistoryStore } from "./core/context/history-store.js";
import { createOrchestrationSessionStore } from "./core/context/orchestration-session-store.js";
import { buildChatPromptFromContext } from "./core/context/chat-prompt-builder.js";
import {
  buildRuleKey as _buildRuleKey,
  evaluatePseudoHooks as _evaluatePseudoHooks
} from "./core/orchestration/pseudo-hooks.js";

// Resolve project root from this file location so cross-repo clients can share one server.
const ROOT = resolveProjectRootFromFile(import.meta.url);

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
  appendInstruction?: string
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
      appendInstruction
    },
    {
      root: ROOT,
      findMdFilesRecursive,
      toPosixPath,
      truncateContent,
      getMdFileAsync
    }
  );
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
const OPERATIONS_LOG_FILE = join(ROOT, "outputs", "operations-log.jsonl");
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
const { emitSystemEvent, loadSystemEvents, registerToolFailure } = createSystemEventManager({
  rootDir: ROOT,
  ensureDir,
  applyEventAutomation,
  bridgeCoreEvent: async (event, timestamp, payload) => {
    await emitEvent({
      type: event,
      timestamp,
      payload
    });
  }
});

const server = new McpServer({
  name: "salesforce-ai-company",
  version: "1.0.0"
});

type RegisteredToolHandler = (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

const registeredToolHandlers = new Map<string, RegisteredToolHandler>();
const registeredToolMetadata = new Map<string, { title?: string; description?: string }>();
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
    description: (config as { description?: string })?.description
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

// ============================================================
// ガバナンス対応ツール登録ラッパー（disable チェック付き）
// ============================================================

let cachedDisabledTools: Set<string> = new Set();

async function refreshDisabledToolsCache(): Promise<void> {
  try {
    const state = await loadGovernanceState();
    cachedDisabledTools = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));
  } catch {
    cachedDisabledTools = new Set();
  }
}

const { govTool } = createGovernedToolRegistrar({
  registerTool: (name, config, handler) => {
    server.registerTool(name as any, config as any, handler as any);
  },
  isToolDisabled: (toolName) => cachedDisabledTools.has(toolName),
  normalizeResourceName,
  emitSystemEvent,
  summarizeValue,
  registerToolFailure
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

const HISTORY_DIR = join(ROOT, "outputs", "history");
const PRESETS_DIR = join(ROOT, "outputs", "presets");
const SESSIONS_DIR = join(ROOT, "outputs", "sessions");

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

const { createPreset, listPresetsData, getPreset } = createPresetStore({ presetsDir: PRESETS_DIR, ensureDir });
const { saveChatHistory, loadChatHistories, restoreChatHistory } = createHistoryStore({
  historyDir: HISTORY_DIR,
  ensureDir,
  agentLog
});
const { saveOrchestrationSession, restoreOrchestrationSession } = createOrchestrationSessionStore<OrchestrationSession>({
  sessionsDir: SESSIONS_DIR,
  ensureDir,
  getSession: (sessionId) => orchestrationSessions.get(sessionId),
  setSession: (session) => {
    orchestrationSessions.set(session.id, session);
  },
  toRelativePosixPath: (absoluteFilePath) => toPosixPath(relative(ROOT, absoluteFilePath))
});

// ============================================================
// Resource Governance（スキル・ツール・プリセット管理）
// ============================================================

const GOVERNANCE_FILE = join(ROOT, "outputs", "resource-governance.json");
const TOOL_PROPOSALS_DIR = join(ROOT, "outputs", "tool-proposals");
const CUSTOM_TOOLS_DIR = join(ROOT, "outputs", "custom-tools");

const { loadedCustomToolNames, registerCustomTool, unregisterCustomTool, loadCustomToolsFromDir } = createCustomToolRegistry({
  govTool,
  filterDisabledSkills,
  buildChatPrompt
});

const BUILTIN_TOOL_CATALOG = [
  "repo_analyze",
  "apex_analyze",
  "lwc_analyze",
  "deploy_org",
  "run_tests",
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
  "smart_chat",
  "analyze_chat_trends",
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
  state: any // GovernanceState
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
  state: any // GovernanceState
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
  state: any // GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingTools = listToolsCatalog(state);
  return validateToolCreation(toolName, toolDescription, existingTools);
}

function registerAllTools(): void {
  registerCoreAnalysisTools(govTool);
  registerBranchReviewTools(govTool);
  registerResourceCatalogTools({ govTool, listMdFiles, getMdFile });

  registerChatOrchestrationTools({
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    orchestrationSessions,
    saveOrchestrationSession,
    restoreOrchestrationSession,
    sessionsDir: join(ROOT, "outputs", "sessions"),
    readDir: (path) => fsPromises.readdir(path),
    readFile: (path, encoding) => fsPromises.readFile(path, encoding)
  });

  registerLoggingTools({
    govTool,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools
  });

  registerHistoryTools({
    govTool,
    agentLog,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    emitSystemEvent
  });

  registerResourceSearchTools({
    govTool,
    loadGovernanceState,
    listMdFiles,
    listPresetsData,
    scoreByQuery,
    emitSystemEvent,
    lowRelevanceScoreThreshold: LOW_RELEVANCE_SCORE_THRESHOLD,
    registeredToolMetadata
  });

  registerPresetTools({
    govTool,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    filterDisabledSkills,
    buildChatPrompt,
    emitSystemEvent
  });

  registerSmartChatTools({
    govTool,
    root: ROOT,
    filterDisabledSkills,
    buildChatPrompt
  });

  registerAnalyticsTools({
    govTool,
    agentLog,
    loadChatHistories,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir
  });

  registerExportTools({
    govTool,
    agentLog,
    loadChatHistories,
    ensureDir
  });

  registerMemoryTools({
    govTool,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory
  });

  registerContextTools({
    govTool,
    root: ROOT,
    findMdFilesRecursive,
    toPosixPath
  });

  registerVectorPromptTools({
    govTool,
    addRecord,
    searchByKeyword,
    buildPrompt
  });

  registerBatchTools({
    govTool,
    buildChatPrompt
  });

  registerKamilessTools({
    govTool,
    root: ROOT
  });

  registerResourceGovernanceTools({
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    getCatalogCounts,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    emitSystemEvent
  });

  registerResourceActionTools({
    govTool,
    root: ROOT,
    presetsDir: PRESETS_DIR,
    toolProposalsDir: TOOL_PROPOSALS_DIR,
    customToolsDir: CUSTOM_TOOLS_DIR,
    governanceFile: GOVERNANCE_FILE,
    loadGovernanceState,
    saveGovernanceState,
    ensureDir,
    loadRecentOperations,
    checkDailyLimitExceeded,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality,
    createPreset,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    toPosixPath
  });
}

registerAllTools();

async function main(): Promise<void> {
  // 起動時: カスタムツールを読み込み登録、disabled キャッシュを初期化
  await loadCustomToolsFromDir(CUSTOM_TOOLS_DIR);
  await refreshDisabledToolsCache();

  // ============================================================
  // Phase 5: Auto-Initialize Handlers (Event-Driven Auto-Execution)
  // ============================================================
  autoInitializeHandlers(handlersState);
  console.error("[Server] Handlers auto-initialization complete");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server failed to start", error);
    process.exit(1);
  });
}


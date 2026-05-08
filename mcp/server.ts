// .env を全モジュールより前に読み込む (副作用 import)。
// 注意: ESM の import は宣言順に評価されるため、必ずトップに配置すること。
import "./env-loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
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
  findMdFilesRecursive,
  toPosixPath,
  truncateContent,
  listMdFiles as listMdFilesFromCatalog,
  getMdFile as getMdFileFromCatalog,
  getMdFileAsync as getMdFileAsyncFromCatalog
} from "./core/context/markdown-catalog.js";
import { createCustomToolRegistry } from "./core/resource/custom-tool-registry.js";
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
  generateHandlersDashboard
} from "./handlers/auto-init.js";

// ============================================================
// Memory / Prompt-Engine / Statistics
// ============================================================
import { addMemory, searchMemory, listMemory, clearMemory } from "../memory/project-memory.js";
import {
  recordFailureMemory,
  searchFailureMemory,
  listFailureMemory
} from "../memory/failure-memory.js";
import { addRecord, searchByKeyword, searchByKeywordAsync } from "../memory/vector-store.js";
import { buildPrompt } from "../prompt-engine/prompt-builder.js";
import { evaluatePromptMetrics } from "../prompt-engine/prompt-evaluator.js";
import {
  exportStatisticsAsCsv,
  exportStatisticsAsJson
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
import { resolveStateBackend } from "./core/persistence/state-store.js";
import {
  type GovernanceState
} from "./core/governance/governance-state.js";
import { createPresetStore } from "./core/context/preset-store.js";
import { createHistoryStore } from "./core/context/history-store.js";
import { PostgresSessionStore } from "./core/persistence/session-store.postgres.js";
import { SqliteSessionStore } from "./core/persistence/session-store.sqlite.js";
import type { SessionStore } from "./core/persistence/session-store.js";
import { createOrchestrationQueueStore } from "./core/orchestration/orchestration-queue-store.js";
import { createOrchestrationJobRunner } from "./core/orchestration/job-runner.js";
import { createPolicySnapshotManager } from "./core/learning/policy-snapshot.js";
import { createPromptRenderer } from "./core/context/prompt-rendering.js";
import { isEnvFlagEnabled } from "./core/config/env-flags.js";
import { evaluatePseudoHooks as evaluatePseudoHooksCore } from "./core/orchestration/pseudo-hooks.js";
import { createChatToolRunner, generateSessionId } from "./core/orchestration/chat-tool-runner.js";
import { clearOrchestrationSessionsForTest } from "./core/orchestration/session-registry.js";
import { chatInputSchema, triggerRuleSchema } from "./core/orchestration/schemas.js";
import { getDefaultSchedulesFilePath, loadCleanupSchedules } from "./core/resource/cleanup-scheduler.js";
import type { SystemEventType } from "./core/event/event-dispatcher.js";
import { createLogger } from "./core/logging/logger.js";
import { getLowRelevanceScoreThreshold } from "./core/config/runtime-config.js";
import { startObservabilityRuntime } from "./core/observability/runtime.js";
import {
  createBanditState,
  loadBanditState,
  saveBanditState
} from "./core/learning/rl-feedback.js";
import { createServerResourceDeps } from "./server-resource-deps.js";
import { resolveServerRuntimePaths } from "./core/server/server-runtime-paths.js";
import { createShutdownStatePersistence } from "./core/server/shutdown-state-persistence.js";
import {
  createProposalQueueStore,
  resolveProposalQueueBackend,
  type ProposalQueueStore
} from "./core/resource/proposal/proposal-queue-store.js";

const {
  root: ROOT,
  outputsDir: OUTPUTS_DIR,
  stateDbPath: STATE_DB_PATH,
  banditStateFile: BANDIT_STATE_FILE,
  startupWarnings: outputsDirStartupWarnings
} = resolveServerRuntimePaths(import.meta.url, process.env);
const logger = createLogger("Server");

// Log environment variables for debugging output directory configuration
logger.debug(`SF_AI_OUTPUTS_DIR env: ${process.env.SF_AI_OUTPUTS_DIR || "(not set)"}`);
logger.debug(`Resolved OUTPUTS_DIR: ${OUTPUTS_DIR}`);
logger.debug(`process.cwd(): ${process.cwd()}`);
for (const warning of outputsDirStartupWarnings) {
  logger.warn(warning);
}

let banditState = createBanditState();

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
// NOTE: Postgres ベースではファイルベースのログは不要（audit_logs テーブル使用）
const { loadRecentOperations, appendOperationLog } = createOperationLog({
  logFile: "",
  ensureDir,
  databaseUrl: process.env.DATABASE_URL
});
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
const GOVERNANCE_STORAGE_PATH = STATE_DB_PATH;
const STATE_BACKEND = resolveStateBackend(process.env.SF_AI_STATE_BACKEND);
const DATABASE_URL = process.env.DATABASE_URL;
const PROPOSAL_QUEUE_BACKEND = resolveProposalQueueBackend(process.env.SF_AI_PROPOSAL_QUEUE_BACKEND, STATE_BACKEND);
const TOOL_PROPOSALS_DIR = join(OUTPUTS_DIR, "tool-proposals");
const CUSTOM_TOOLS_DIR = join(OUTPUTS_DIR, "custom-tools");
const governanceStateManager = createGovernanceStateManager({
  defaultProtectedTools: DEFAULT_PROTECTED_TOOLS,
  governanceFile: GOVERNANCE_FILE,
    ensureDir,
  sqliteDbPath: STATE_DB_PATH,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
});
const buildDefaultGovernanceState = () => governanceStateManager.buildDefaultGovernanceState();
const loadGovernanceState = () => governanceStateManager.loadGovernanceState();
const saveGovernanceState = (state: GovernanceState) => governanceStateManager.saveGovernanceState(state);
const normalizeDisabledEntries = (names: string[]) => governanceStateManager.normalizeDisabledEntries(names);
const normalizeProtectedTools = (names: string[]) => governanceStateManager.normalizeProtectedTools(names);

const { emitSystemEvent, loadSystemEvents, registerToolFailure, getSystemEventLogStatus } = createSystemEventManager({
  rootDir: ROOT,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL,
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
  governanceFilePath: GOVERNANCE_STORAGE_PATH,
  logger,
  loadGovernanceState,
  normalizeResourceName,
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
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
  databaseUrl: DATABASE_URL,
  serverRoot: ROOT,
  emitSystemEvent: emitSystemEventCompat,
  summarizeValue,
  registerToolFailure,
  getBanditState: () => banditState,
  banditStateFile: BANDIT_STATE_FILE,
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
const USE_SQLITE_HISTORY = isEnvFlagEnabled("SF_AI_HISTORY_SQLITE");
const ALLOW_HISTORY_FILE_FALLBACK = isEnvFlagEnabled("SF_AI_HISTORY_FILE_FALLBACK");
const ALLOW_PRESET_FILE_FALLBACK = isEnvFlagEnabled("SF_AI_PRESET_FILE_FALLBACK");
// NOTE: Postgres ベースではディレクトリベースの履歴管理は不要
// すべて Postgres state_records テーブルに保存される
const PRESETS_DIR = join(OUTPUTS_DIR, "presets");
const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_FILES = 200;
const SESSION_RETENTION_DAYS = 30;

// NOTE: Postgres ベースでは ensureDir は不要だが、
// 既存モジュール互換性のため dummy 実装を提供
async function ensureDir(_dir: string): Promise<void> {
  // No-op: Postgres ベースでは dir creation は不要
}

const { createPreset, listPresetsData, getPreset } = createPresetStore({
  presetsDir: PRESETS_DIR,
  ensureDir,
  allowFileFallback: ALLOW_PRESET_FILE_FALLBACK
});
const { saveChatHistory, saveSessionHistory, loadChatHistories, restoreChatHistory } = createHistoryStore({
  historyDir: HISTORY_DIR,
  ensureDir,
  agentLog,
  maxHistoryFiles: HISTORY_MAX_FILES,
  retentionDays: HISTORY_RETENTION_DAYS,
  allowFileFallback: ALLOW_HISTORY_FILE_FALLBACK,
  sqlite: {
    enabled: USE_SQLITE_HISTORY,
    dbPath: STATE_DB_PATH
  }
});
const sessionStore: SessionStore = STATE_BACKEND === "postgres" && DATABASE_URL
  ? await PostgresSessionStore.open({
      databaseUrl: DATABASE_URL,
      retentionDays: SESSION_RETENTION_DAYS
    })
  : SqliteSessionStore.open({
      dbPath: STATE_DB_PATH,
      retentionDays: SESSION_RETENTION_DAYS
    });
const orchestrationQueueStore = await createOrchestrationQueueStore({
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL,
  queuePrefix: "orchestration-session"
});
const orchestrationJobRunner = createOrchestrationJobRunner({
  stateBackend: STATE_BACKEND,
  databaseUrl: DATABASE_URL
});
const policySnapshotManager = createPolicySnapshotManager({
  banditStateFile: BANDIT_STATE_FILE,
  agentReputationFile: join(OUTPUTS_DIR, "agent-reputation.jsonl"),
  databaseUrl: DATABASE_URL,
  debounceMs: 200
});
const proposalQueue: ProposalQueueStore = await createProposalQueueStore({
  backend: PROPOSAL_QUEUE_BACKEND,
  outputsDir: OUTPUTS_DIR,
  databaseUrl: DATABASE_URL
});

if (
  PROPOSAL_QUEUE_BACKEND === "pg-boss" &&
  typeof proposalQueue.scheduleRecurringJob === "function" &&
  typeof proposalQueue.unscheduleRecurringJob === "function"
) {
  try {
    const cleanupSchedules = await loadCleanupSchedules(getDefaultSchedulesFilePath(ROOT));
    for (const schedule of cleanupSchedules.schedules) {
      if (schedule.status !== "active") {
        await proposalQueue.unscheduleRecurringJob({
          queue: "governance-auto-cleanup",
          key: schedule.id
        });
        continue;
      }

      await proposalQueue.scheduleRecurringJob({
        queue: "governance-auto-cleanup",
        cron: schedule.cron,
        key: schedule.id,
        data: {
          scheduleId: schedule.id,
          action: schedule.action,
          daysUnused: schedule.daysUnused,
          limit: schedule.limit,
          requireApproval: schedule.requireApproval
        }
      });
    }
  } catch (error) {
    logger.warn(`cleanup schedule startup sync failed: ${summarizeValue(error, 300)}`);
  }
}

const { loadedCustomToolNames, registerCustomTool, unregisterCustomTool, loadCustomToolsFromDir } = createCustomToolRegistry({
  govTool,
  filterDisabledSkills,
  buildChatPrompt: buildChatPromptCompat
});

const {
  listSkillsCatalog,
  listPresetsCatalog,
  listToolsCatalog,
  resourceScore,
  validateAndCreateSkillWithQuality,
  validateAndCreatePresetWithQuality,
  validateAndCreateToolWithQuality
} = createServerResourceDeps({
  root: ROOT,
  findMdFilesRecursive,
  toPosixPath,
  listPresetsData,
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

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  await governanceEventAutomation.applyEventAutomation(event, payload);
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
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    policySnapshotManager,
    saveSessionHistory,
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
    recordFailureMemory,
    searchFailureMemory,
    listFailureMemory,
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
    resourceScore,
    proposalQueue
  });

const { persistShutdownState, registerShutdownHooks } = createShutdownStatePersistence({
  getBanditState: () => banditState,
  banditStateFile: BANDIT_STATE_FILE,
  saveBanditState,
  loadGovernanceState,
  saveGovernanceState,
  logger
});

async function main(): Promise<void> {
  registerShutdownHooks();
  banditState = await loadBanditState(BANDIT_STATE_FILE);
  logger.info(`Bandit state loaded (${banditState.arms.size} arms)`);
  await policySnapshotManager.start();
  logger.info(`Policy snapshot started (mode=${policySnapshotManager.mode})`);

  const observabilityRuntime = await startObservabilityRuntime(logger);
  observabilityRuntime.setReady(false);

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
  observabilityRuntime.setStartupComplete(true);
  observabilityRuntime.setReady(true);

  try {
    await startMcpTransport(server, logger);
  } finally {
    await persistShutdownState("main-finally");
    if (typeof proposalQueue.close === "function") {
      await proposalQueue.close();
    }
    await policySnapshotManager.close();
    await orchestrationJobRunner.close();
    await orchestrationQueueStore.close();
    await sessionStore.close();
    await observabilityRuntime.stop();
  }
}

runWithLifecycle({
  importMetaUrl: import.meta.url,
  argvPath: process.argv[1],
  logger,
  start: main
});

